import { buildWhere, groupedQuery, datasetUrl } from '../dist/research.js';

async function request(dataset, params) {
  const response = await fetch(datasetUrl(dataset, params), { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${dataset}: HTTP ${response.status}: ${await response.text()}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('Expected an array from NYC Open Data.');
  return rows;
}

const outcomes = await Promise.allSettled(['all', 'heat', 'pest', 'paint'].map(async service => {
  const where = buildWhere({ boro: 'BROOKLYN', service });
  const buildings = await request('wvxf-dwi5', groupedQuery(where, 1));
  if (!buildings.length) throw new Error(`No records available to verify ${service}.`);
  const building = buildings[0];
  if (!/^\d+$/.test(building.buildingid) || !/^\d+$/.test(building.total)) throw new Error('Unexpected building fields.');
  const violations = await request('wvxf-dwi5', { where: `${where} AND buildingid='${building.buildingid}'`, limit: '1' });
  if (!violations[0]?.novdescription) throw new Error('Missing matching violation description.');
  if (violations[0].violationstatus !== 'Open') throw new Error('Search returned a closed record.');
  return { service, groupedSearch: 'passed', matchingDetails: 'passed' };
}));
let failed = false;
outcomes.forEach(result => { if (result.status === 'rejected') { failed = true; console.error(result.reason.message); } else console.log(JSON.stringify(result.value)); });
const contacts = await request('feu5-w2e2', { limit: '1' });
if (!contacts[0]?.registrationid) throw new Error('Missing registration contact schema.');
console.log('Registered contacts dataset: passed');
if (failed) process.exitCode = 1;
