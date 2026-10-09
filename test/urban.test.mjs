import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeBBL, validCoordinates, propertyWhere } from '../dist/urban.js';
import { compareSnapshot, buildMonitorWorkflow } from '../dist/monitor.js';

const row = { violationid: '123', buildingid: '877800', class: 'C', currentstatus: 'NOV SENT OUT', currentstatusdate: '2026-10-08', novdescription: 'Test record' };
test('BBL joins use borough/block/lot and invalid coordinates never create a pin', () => {
  assert.equal(makeBBL('3', '1755', '20'), '3017550020');
  assert.equal(makeBBL('3', '0', '0'), null);
  assert.equal(makeBBL('6', '1755', '20'), null);
  assert.deepEqual(validCoordinates({ latitude: '40.7', longitude: '-73.94' }), [40.7, -73.94]);
  assert.equal(validCoordinates({ latitude: '', longitude: '-73.94' }), null);
  assert.equal(validCoordinates({ latitude: '0', longitude: '0' }), null);
});
test('property search supports multifamily and individual addresses without accepting arbitrary query clauses', () => {
  const where = propertyWhere({ boro: 'BROOKLYN', zip: '11206', query: 'MYRTLE AVENUE', minUnits: '3' });
  assert.match(where, /unitsres>=3/); assert.match(where, /zipcode='11206'/);
  assert.match(where, /MYRTLE AVENUE/);
  assert.throws(() => propertyWhere({ boro: 'BROOKLYN', query: "' OR true" }));
});
test('first snapshot establishes a baseline; unchanged records do not fabricate alerts', () => {
  const first = compareSnapshot(null, [row]); assert.equal(first.baseline, true); assert.equal(first.events.length, 0);
  assert.equal(compareSnapshot(first.snapshot, [row]).events.length, 0);
  const changed = compareSnapshot(first.snapshot, [{ ...row, currentstatus: 'CERTIFICATION RECEIVED' }]);
  assert.equal(changed.events[0].type, 'Record status updated');
  const removed = compareSnapshot(first.snapshot, []);
  assert.match(removed.events[0].type, /verify with HPD/);
});
test('duplicate and truncated snapshots fail before baseline replacement', () => {
  assert.throws(() => compareSnapshot(null, [row, row]), /Duplicate/);
  assert.throws(() => compareSnapshot(null, Array.from({ length: 1001 }, (_, i) => ({ ...row, violationid: String(i) }))), /Incomplete/);
  assert.throws(() => compareSnapshot(null, [{}]), /Incomplete/);
});
test('exported n8n code runs independently and rejects malformed HTTP responses', () => {
  const workflow = buildMonitorWorkflow([{ record: { pluto: { address: '854 MYRTLE AVENUE' }, hpdBuildings: [{ buildingid: '877800' }] } }]);
  assert.equal(workflow.active, false); assert.equal(workflow.settings.timezone, 'America/New_York');
  const configNode = workflow.nodes.find(n => n.id === 'config'), compareNode = workflow.nodes.find(n => n.id === 'diff');
  assert.equal(workflow.nodes.find(n => n.id === 'request').parameters.options.response.response.fullResponse, true);
  const prepared = vm.runInNewContext(`(function(){${configNode.parameters.jsCode}})()`)[0].json;
  assert.match(decodeURIComponent(prepared.url), /buildingid in\('877800'\)/);
  const state = {};
  const runResponse = response => vm.runInNewContext(`(function(){${compareNode.parameters.jsCode}})()`, { $: () => ({ first: () => ({ json: prepared }) }), $input: { all: () => [{ json: response }] }, $getWorkflowStaticData: () => state });
  const run = rows => runResponse({ statusCode: 200, body: rows });
  assert.equal(run([row])[0].json.baseline, true);
  assert.equal(run([row])[0].json.changes.length, 0);
  const previous = JSON.stringify(state);
  assert.throws(() => run([{ error: 'Source unavailable' }]), /Unexpected/);
  assert.throws(() => runResponse({ statusCode: 200, body: {} }), /Unexpected/);
  assert.throws(() => runResponse({ statusCode: 503, body: [] }), /Unexpected/);
  assert.equal(JSON.stringify(state), previous);
  assert.match(run([])[0].json.changes[0].type, /verify with HPD/);
  assert.equal(run([])[0].json.changes.length, 0);
  assert.throws(() => buildMonitorWorkflow([]), /matched HPD/);
});
