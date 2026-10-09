import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parseRequestCSV, auditRequests, requestDraft, requestAuditWorkflow } from '../dist/request-audit.js';

// Synthetic fixtures exercise behaviour; no demonstration customers appear in the app.
const now = '2026-10-09T16:00:00Z';
const request = { id: 'test-1', type: 'residential', reference: 'Synthetic test', received_at: '2026-10-09T09:00:00-04:00', status: 'new' };
test('CSV preserves quoted references and accepts BOM/CRLF without silently dropping malformed rows', () => {
  const rows = parseRequestCSV('\uFEFFid,type,reference,received_at,status\r\ntest-1,residential,"Quoted, reference\nsecond line",2026-10-09T09:00:00-04:00,new\r\n');
  assert.equal(rows.length, 1); assert.equal(rows[0].reference, 'Quoted, reference\nsecond line');
  assert.throws(() => parseRequestCSV('id,type,received_at,status\nx,residential,new'), /number of fields/);
  assert.throws(() => parseRequestCSV('id,id,type,received_at,status'), /unique/);
});
test('audit uses the supplied response target and flags missing history as unrecorded', () => {
  const report = auditRequests([request], { now, slaHours: 2 });
  assert.equal(report.totals.review, 1); assert.equal(report.totals.responseUnrecorded, 1);
  assert.match(report.requests[0].flags.find(f => f.code === 'response_unrecorded').next, /Check email\/call history/);
  assert.equal(auditRequests([request], { now, slaHours: 4 }).totals.responseUnrecorded, 0);
});
test('closed and opted-out requests generate no follow-up flags', () => {
  for (const status of ['won', 'closed', 'opted_out']) { assert.equal(auditRequests([{ ...request, status }], { now }).requests[0].flags.length, 0); assert.equal(requestDraft({ ...request, status }), ''); }
});
test('recorded responses clear response review; actual action and appointment times remain independently reviewable', () => {
  const report = auditRequests([{ ...request, assignee: 'Test reviewer', response_at: '2026-10-09T14:00:00Z', next_action_at: '2026-10-09T15:00:00Z', status: 'appointment', appointment_at: '2026-10-09T15:30:00Z' }], { now });
  assert.deepEqual(report.requests[0].flags.map(f => f.code), ['action_due', 'appointment_outcome']);
  assert.equal(requestDraft(report.requests[0]), '');
});
test('ambiguous dates, duplicate IDs and inconsistent response times fail before results are produced', () => {
  assert.throws(() => auditRequests([{ ...request, received_at: '2026-10-09 09:00' }], { now }), /timezone/);
  assert.throws(() => auditRequests([request, request], { now }), /Duplicate/);
  assert.throws(() => auditRequests([{ ...request, response_at: '2026-10-08T16:00:00Z' }], { now }), /precedes/);
  assert.throws(() => auditRequests([{ ...request, received_at: '2026-02-31T09:00:00Z' }], { now }), /real calendar/);
  assert.throws(() => auditRequests([request], { now, slaHours: 0 }), /response target/);
});
test('n8n audit export is inactive and requires authentication; its core code runs on supplied data', () => {
  const workflow = requestAuditWorkflow();
  assert.equal(workflow.active, false); assert.equal(workflow.nodes[0].parameters.authentication, 'headerAuth');
  const result = vm.runInNewContext(`(function(){${workflow.nodes.find(n => n.id === 'audit').parameters.jsCode}})()`, { $input: { first: () => ({ json: { body: { requests: [request], slaHours: 2 } } }) } });
  assert.equal(result[0].json.totals.requests, 1);
  assert.throws(() => vm.runInNewContext(`(function(){${workflow.nodes.find(n => n.id === 'audit').parameters.jsCode}})()`, { $input: { first: () => ({ json: { body: {} } }) } }), /Provide/);
});
