import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWhere, csv, shortlistCsv, contactName } from '../dist/research.js';

test('service-area queries retain open status, date window, ZIP, and trade filters', () => {
  const where = buildWhere({ boro: 'BROOKLYN', service: 'pest', zip: '11206' }, new Date('2026-10-09T12:00:00Z'));
  assert.match(where, /violationstatus='Open'/);
  assert.match(where, /approveddate>='2025-10-09T00:00:00'/);
  assert.match(where, /zip='11206'/);
  assert.match(where, /upper\(novdescription\) like '%MICE%'/);
  assert.throws(() => buildWhere({ boro: "BROOKLYN' OR true", service: 'all' }));
  assert.throws(() => buildWhere({ boro: 'BROOKLYN', service: 'all', zip: "11206'" }));
});

test('CSV preserves multiline notes and quotes while neutralizing spreadsheet formulas', () => {
  const output = csv([['note', 'value'], ['Line one\n"Line two"', '=HYPERLINK("https://example.com")']]);
  assert.match(output, /"Line one\n""Line two"""/);
  assert.match(output, /"'=HYPERLINK/);
  assert.ok(output.startsWith('\uFEFF'));
});

test('shortlist export includes research context, qualification, notes, and registered contacts', () => {
  const output = shortlistCsv([{ savedAt: '2026-10-09', context: { serviceLabel: 'Pest control' }, record: { buildingid: '123', registrationid: '456', housenumber: '12', streetname: 'SAMPLE ST', boro: 'BROOKLYN', total: '3', class_c: '1' }, status: 'Needs review', notes: 'Confirm manager', contacts: [{ corporationname: 'Sample LLC', type: 'CorporateOwner', businesscity: 'NEW YORK' }] }]);
  assert.match(output, /Pest control/);
  assert.match(output, /Needs review/);
  assert.match(output, /Confirm manager/);
  assert.match(output, /Sample LLC \(CorporateOwner\) — NEW YORK/);
  assert.match(output, /feu5-w2e2/);
  assert.equal(contactName({ firstname: 'Jane', lastname: 'Sample' }), 'Jane Sample');
});
