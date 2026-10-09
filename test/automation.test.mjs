import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { watchInput, snapshotResult, noticeMessage, deliveryAccepted, operatorMessage, healthMessage, buildAutomationWorkflows } from '../automation/workflows.mjs';

// All rows below are synthetic QA inputs. They are never included in application data or exported workflows.
const db = new PGlite();
const schema = await fs.readFile(new URL('../automation/schema.sql', import.meta.url), 'utf8');
before(async () => { await db.exec(schema); });
after(async () => { await db.close(); });
const row = (id = '1', extra = {}) => ({ violationid: id, buildingid: '101', violationstatus: 'Open', class: 'B', currentstatus: 'NOV SENT', currentstatusdate: '2026-10-01T00:00:00', novdescription: 'Synthetic QA record', ...extra });
const q = async (sql, values = []) => (await db.query(sql, values)).rows;
const watch = (w, action = 'watch') => q('SELECT blocksignal.watch_property($1,$2,$3,$4) AS result', [w, '101', 'Synthetic QA address', action]);
const claim = (w, token = 'worker-one') => q('SELECT * FROM blocksignal.claim_checks($1,$2)', [w, token]);
const due = w => q("UPDATE blocksignal.properties SET next_due=now()-interval '1 minute' WHERE workspace=$1", [w]);
const commit = async (w, rows, token = 'worker-one') => (await q('SELECT blocksignal.commit_check($1,$2,$3,$4::jsonb) AS result', [w, '101', token, JSON.stringify({ ok: true, rows })]))[0].result;
const fail = w => q('SELECT blocksignal.commit_check($1,$2,$3,$4::jsonb) AS result', [w, '101', 'worker-one', JSON.stringify({ ok: false, errorCode: 'source_http_error' })]);
const notice = (w, token = 'mailer-one') => q('SELECT * FROM blocksignal.claim_notices($1,$2)', [w, token]);
const finish = (w, id, sent, token = 'mailer-one') => q('SELECT blocksignal.finish_notice($1,$2::bigint,$3,$4::boolean) AS result', [w, id, token, sent]);
const dueNotice = w => q("UPDATE blocksignal.outbox SET next_attempt=now()-interval '1 minute' WHERE workspace=$1", [w]);
async function newNotice(w) { await watch(w); await claim(w); await commit(w, []); await due(w); await claim(w); await commit(w, [row('1', { class: 'C' })]); }

test('watch requests use a fixed authorised workspace; source validation rejects wrong scope, partial and malformed snapshots', () => {
  assert.equal(watchInput({ workspaceId: 'forged', buildingId: '101', address: 'QA' }, 'qa-team').workspaceId, 'qa-team');
  assert.throws(() => watchInput({ buildingId: "101' OR true", address: 'QA' }, 'qa-team'));
  assert.throws(() => watchInput({ buildingId: '101', address: 'QA' }, 'REPLACE_WORKSPACE_ID'));
  for (const response of [{ statusCode: 503, body: [] }, { statusCode: 200, body: {} }, { statusCode: 200, body: [row(), row()] }, { statusCode: 200, body: [row('1', { buildingid: '202' })] }, { statusCode: 200, body: Array.from({ length: 1001 }, (_, i) => row(String(i))) }]) assert.equal(snapshotResult(response, '101').ok, false);
  assert.deepEqual(snapshotResult({ statusCode: 200, body: [] }, '101'), { ok: true, rows: [] });
});

test('a first baseline emits no historical alert; unchanged data stays quiet and new class C changes create one durable notice', async () => {
  const w = 'qa-baseline'; await watch(w); await claim(w);
  assert.deepEqual(await commit(w, [row()]), { accepted: true, baseline: true, changes: 0 });
  assert.equal((await q('SELECT * FROM blocksignal.outbox WHERE workspace=$1', [w])).length, 0);
  await due(w); await claim(w); assert.equal((await commit(w, [row()])).changes, 0);
  await due(w); await claim(w); assert.equal((await commit(w, [row(), row('2', { class: 'C' })])).changes, 1);
  const notices = await q('SELECT * FROM blocksignal.outbox WHERE workspace=$1', [w]);
  assert.equal(notices.length, 1); assert.equal(notices[0].payload.changes[0].priority, 'urgent_review');
  await due(w); await claim(w); assert.equal((await commit(w, [row(), row('2', { class: 'C' })])).changes, 0);
  assert.equal((await q('SELECT * FROM blocksignal.outbox WHERE workspace=$1', [w])).length, 1);
});

test('database validation rolls back invalid writes, and failures preserve the previous successful baseline', async () => {
  const w = 'qa-validation'; await watch(w); await claim(w); await commit(w, [row()]);
  const previous = (await q('SELECT snapshot,last_checked,revision FROM blocksignal.properties WHERE workspace=$1', [w]))[0];
  await due(w); await claim(w);
  await assert.rejects(commit(w, [row(), row()]), /Duplicate/);
  await assert.rejects(commit(w, [row('2', { buildingid: '999' })]), /Invalid snapshot/);
  assert.deepEqual((await q('SELECT snapshot,last_checked,revision FROM blocksignal.properties WHERE workspace=$1', [w]))[0], previous);
  await fail(w);
  assert.deepEqual((await q('SELECT snapshot,last_checked,revision FROM blocksignal.properties WHERE workspace=$1', [w]))[0], previous);
});

test('one outage report follows three failures; repeated failures do not spam and recovery records the observation gap', async () => {
  const w = 'qa-outage'; await watch(w); await claim(w); await commit(w, [row()]);
  for (let i = 0; i < 4; i++) { await due(w); await claim(w); await fail(w); }
  let notices = await q('SELECT * FROM blocksignal.outbox WHERE workspace=$1', [w]);
  assert.equal(notices.length, 1); assert.equal(notices[0].payload.changes[0].kind, 'source_unavailable');
  await due(w); await claim(w); await commit(w, [row()]);
  notices = await q('SELECT * FROM blocksignal.outbox WHERE workspace=$1 ORDER BY id', [w]);
  assert.equal(notices.length, 2); assert.equal(notices[1].payload.changes[0].kind, 'source_recovered');
  assert.equal((await q('SELECT failures FROM blocksignal.properties WHERE workspace=$1', [w]))[0].failures, 0);
});

test('expiring property leases prevent stale workers from overwriting another successful check', async () => {
  const w = 'qa-leases'; await watch(w); assert.equal((await claim(w, 'first')).length, 1);
  assert.equal((await claim(w, 'second')).length, 0); assert.equal((await claim('qa-other', 'second')).length, 0);
  await q("UPDATE blocksignal.properties SET lease_until=now()-interval '1 minute' WHERE workspace=$1", [w]);
  assert.equal((await claim(w, 'second')).length, 1);
  await assert.rejects(commit(w, [row()], 'first'), /Stale/);
  await commit(w, [], 'second');
});

test('failed mail delivery retains the alert; subsequent acceptance closes it and stale acknowledgments are rejected', async () => {
  const w = 'qa-mail'; await newNotice(w); let n = (await notice(w))[0];
  await finish(w, n.id, false); assert.equal((await q('SELECT delivered_at FROM blocksignal.outbox WHERE workspace=$1', [w]))[0].delivered_at, null);
  await dueNotice(w); n = (await notice(w, 'mailer-two'))[0];
  await assert.rejects(finish(w, n.id, true), /Stale/);
  await finish(w, n.id, true, 'mailer-two'); assert.equal((await notice(w)).length, 0);
});

test('bounded delivery retries leave exhausted alerts visible to operational health', async () => {
  const w = 'qa-exhausted'; await newNotice(w);
  for (let i = 0; i < 5; i++) { await dueNotice(w); const n = (await notice(w))[0]; await finish(w, n.id, false); }
  assert.equal((await notice(w)).length, 0);
  const report = (await q('SELECT blocksignal.health_report($1) AS report', [w]))[0].report;
  assert.equal(report.exhaustedNotices, 1); assert.match(healthMessage(report).text, /exhaustedNotices: 1/);
});

test('pausing a property keeps its history, suppresses pending notices and invalidates an active worker', async () => {
  const w = 'qa-pause'; await newNotice(w); await due(w); await claim(w);
  await watch(w, 'pause'); await assert.rejects(commit(w, []), /Stale/);
  assert.equal((await notice(w)).length, 0);
  assert.equal((await q('SELECT snapshot FROM blocksignal.properties WHERE workspace=$1', [w]))[0].snapshot['1'].recordId, '1');
  assert.ok((await q('SELECT cancelled_at FROM blocksignal.outbox WHERE workspace=$1', [w]))[0].cancelled_at);
});

test('disappearing records are marked for verification; operator messages exclude raw errors and mail acceptance is checked', async () => {
  const w = 'qa-removal'; await watch(w); await claim(w); await commit(w, [row()]); await due(w); await claim(w); await commit(w, []);
  const n = (await notice(w))[0]; const message = noticeMessage(n);
  assert.match(message.text, /does not establish a completed repair/); assert.match(message.text, /https:\/\/hpdonline/);
  assert.equal(deliveryAccepted({ accepted: ['team@example.com'] }, 'team@example.com'), true);
  assert.equal(deliveryAccepted({ error: 'failed' }, 'team@example.com'), false);
  assert.equal(deliveryAccepted({ accepted: [], rejected: ['team@example.com'] }, 'team@example.com'), false);
  assert.doesNotMatch(operatorMessage({ execution: { error: { message: 'PRIVATE SECRET' } } }).text, /PRIVATE SECRET/);
});

test('all exported node code compiles; exports are inactive, credential-free and have valid connection targets', async () => {
  const workflows = buildAutomationWorkflows();
  const files = { watch: '01-property-watch', collector: '02-hpd-collector', notifier: '03-internal-notices', errors: '04-execution-errors', health: '05-health-report' };
  for (const [key, workflow] of Object.entries(workflows)) {
    assert.deepEqual(JSON.parse(await fs.readFile(new URL(`../automation/${files[key]}.json`, import.meta.url), 'utf8')), workflow);
    assert.equal(workflow.active, false); const names = new Set(workflow.nodes.map(n => n.name));
    for (const node of workflow.nodes) {
      assert.equal(node.credentials, undefined);
      if (node.type.endsWith('.code')) new vm.Script(`(function(){${node.parameters.jsCode}})()`);
      if (node.type.endsWith('.postgres')) assert.match(node.parameters.options.queryReplacement, /^=\{\{ \[/);
    }
    for (const [name, outputs] of Object.entries(workflow.connections)) {
      assert.ok(names.has(name)); for (const output of outputs.main) for (const target of output) assert.ok(names.has(target.node));
    }
  }
  assert.equal(workflows.watch.nodes[0].parameters.authentication, 'headerAuth');
  assert.equal(workflows.collector.nodes.find(n => n.id === 'source').retryOnFail, true);
});
