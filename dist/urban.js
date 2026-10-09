import { datasetUrl, buildWhere, groupedQuery } from './research.js';

export const SOURCES = {
  hpd: 'https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Violations/wvxf-dwi5',
  buildings: 'https://data.cityofnewyork.us/Housing-Development/Buildings/kj4p-ruqc',
  pluto: 'https://data.cityofnewyork.us/City-Government/Primary-Land-Use-Tax-Lot-Output-PLUTO/64uk-42ks',
  contacts: 'https://data.cityofnewyork.us/Housing-Development/Registration-Contacts/feu5-w2e2',
  acris: 'https://www.nyc.gov/site/finance/property/acris.page',
};
export const BORO_CODES = { MANHATTAN: '1', BRONX: '2', BROOKLYN: '3', QUEENS: '4', 'STATEN ISLAND': '5' };
export const PLUTO_FIELDS = 'bbl,borocode,borough,block,lot,address,zipcode,ownername,unitsres,unitstotal,yearbuilt,bldgarea,lotarea,numfloors,bldgclass,zonedist1,latitude,longitude,version';
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const address = record => record.pluto?.address || [record.housenumber, record.streetname].filter(Boolean).join(' ') || 'Address unavailable';
export const recordKey = record => record.key || (record.buildingid ? 'building:' + record.buildingid : 'lot:' + record.bbl);

export function makeBBL(borough, block, lot) {
  if (!/^[1-5]$/.test(String(borough)) || !/^\d{1,5}$/.test(String(block)) || !/^\d{1,4}$/.test(String(lot)) || Number(block) <= 0 || Number(lot) <= 0) return null;
  return String(borough) + String(block).padStart(5, '0') + String(lot).padStart(4, '0');
}

export function validCoordinates(pluto) {
  if (!pluto?.latitude || !pluto?.longitude) return null;
  const lat = Number(pluto.latitude), lng = Number(pluto.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 40.4 && lat <= 41 && lng >= -74.3 && lng <= -73.6 ? [lat, lng] : null;
}

export async function api(dataset, params) {
  const response = await fetch(datasetUrl(dataset, params), { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`NYC ${dataset}: HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Unexpected NYC dataset response.');
  return data;
}

const batches = (items, size = 20) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
async function batchRequests(items, fn) {
  const result = [];
  const groups = batches(items);
  for (let i = 0; i < groups.length; i += 3) {
    const responses = await Promise.all(groups.slice(i, i + 3).map(fn));
    for (const response of responses) result.push(...response);
  }
  return result;
}

export async function enrichHPD(records) {
  const ids = [...new Set(records.map(r => r.buildingid).filter(id => /^\d+$/.test(id)))];
  if (!ids.length) return records;
  const buildings = await batchRequests(ids, group => api('kj4p-ruqc', { where: `buildingid in(${group.map(id => `'${id}'`).join(',')})`, limit: '200' }));
  const byId = new Map(buildings.map(b => [b.buildingid, b]));
  const bbls = [...new Set(buildings.map(b => makeBBL(b.boroid, b.block, b.lot)).filter(Boolean))];
  const lots = bbls.length ? await batchRequests(bbls, group => api('64uk-42ks', { select: PLUTO_FIELDS, where: `bbl in(${group.join(',')})`, limit: '200' })) : [];
  const byBBL = new Map(lots.map(p => [String(Math.trunc(Number(p.bbl))), p]));
  return records.map(r => {
    const b = byId.get(r.buildingid), bbl = b && makeBBL(b.boroid, b.block, b.lot);
    return { ...r, key: 'building:' + r.buildingid, bbl, hpdBuildings: b ? [b] : [], pluto: byBBL.get(bbl) || null };
  });
}

export async function findBuildings(criteria) {
  const where = buildWhere(criteria);
  const records = await api('wvxf-dwi5', groupedQuery(where));
  try { return { records: await enrichHPD(records), warning: '' }; }
  catch (error) { return { records: records.map(r => ({ ...r, key: 'building:' + r.buildingid })), warning: `HPD results loaded; property/coordinate enrichment failed. ${error.message}` }; }
}

export function propertyWhere({ boro, zip = '', query = '', minUnits = '1' }) {
  if (!BORO_CODES[boro]) throw new Error('Select a valid borough.');
  if (zip && !/^\d{5}$/.test(zip)) throw new Error('Enter a five-digit ZIP code.');
  if (!['1', '3', '5', '10', '20'].includes(String(minUnits))) throw new Error('Invalid residential unit filter.');
  if (query && !/^[a-z0-9 .,#\/-]{1,80}$/i.test(query)) throw new Error('Use letters, numbers, spaces, periods or hyphens in the address filter.');
  let where = `borocode='${BORO_CODES[boro]}' AND unitsres>=${minUnits}`;
  if (zip) where += ` AND zipcode='${zip}'`;
  if (query) where += ` AND upper(address) like '%${query.toUpperCase()}%'`;
  return where;
}

export async function findProperties(criteria) {
  const lots = await api('64uk-42ks', { select: PLUTO_FIELDS, where: propertyWhere(criteria), order: 'address ASC', limit: '100' });
  return lots.map(p => ({ key: 'lot:' + Math.trunc(Number(p.bbl)), bbl: String(Math.trunc(Number(p.bbl))), boro: criteria.boro, zip: p.zipcode, pluto: p, total: null, class_c: null, latest: null, hpdBuildings: [] }));
}

export async function resolveBuildings(record) {
  if (record.hpdBuildings?.length) return record.hpdBuildings;
  if (record.bbl && /^\d{10}$/.test(record.bbl)) {
    const bbl = record.bbl;
    return api('kj4p-ruqc', { where: `boroid='${bbl[0]}' AND block='${Number(bbl.slice(1, 6))}' AND lot='${Number(bbl.slice(6))}' AND recordstatus='Active'`, limit: '100' });
  }
  if (/^\d+$/.test(record.buildingid || '')) return api('kj4p-ruqc', { where: `buildingid='${record.buildingid}'`, limit: '1' });
  return [];
}

export async function openSnapshot(buildings) {
  const ids = [...new Set(buildings.map(b => b.buildingid).filter(id => /^\d+$/.test(id)))];
  if (!ids.length) return [];
  const rows = await api('wvxf-dwi5', { where: `buildingid in(${ids.map(id => `'${id}'`).join(',')}) AND violationstatus='Open'`, order: 'approveddate DESC,violationid DESC', limit: '1001' });
  if (rows.length > 1000) throw new Error('More than 1,000 open records. Monitoring is paused to avoid comparing an incomplete snapshot.');
  return rows;
}

export async function registeredContacts(buildings) {
  const ids = [...new Set(buildings.map(b => b.registrationid).filter(id => /^\d+$/.test(id) && Number(id) > 0))];
  return ids.length ? api('feu5-w2e2', { where: `registrationid in(${ids.map(id => `'${id}'`).join(',')})`, limit: '200' }) : [];
}

export async function acrisDocuments(record) {
  if (!/^\d{10}$/.test(record.bbl || '') || record.bbl[0] === '5') return { documents: [], note: 'ACRIS property documents cover Manhattan, Bronx, Brooklyn and Queens. Staten Island uses separate records.' };
  const bbl = record.bbl;
  const legal = await api('8h5j-fqxa', { where: `borough='${bbl[0]}' AND block='${Number(bbl.slice(1, 6))}' AND lot='${Number(bbl.slice(6))}'`, order: 'document_id DESC', limit: '20' });
  const ids = [...new Set(legal.map(row => row.document_id).filter(id => /^\d+$/.test(id)))];
  if (!ids.length) return { documents: [], note: 'No matching documents returned for this exact tax lot. Older lot numbers and lot changes are not expanded.' };
  const documents = await api('bnx9-e6tj', { where: `document_id in(${ids.map(id => `'${id}'`).join(',')})`, order: 'recorded_datetime DESC', limit: '20' });
  return { documents, note: 'Up to 20 document IDs for the current tax lot, ordered by recorded date. A document amount is not a market valuation or necessarily a sale price.' };
}

export async function loadDossier(record) {
  const buildings = await resolveBuildings(record);
  if (!record.pluto && buildings[0]) {
    const bbl = makeBBL(buildings[0].boroid, buildings[0].block, buildings[0].lot);
    if (bbl) {
      record = { ...record, bbl };
      try { const lots = await api('64uk-42ks', { select: PLUTO_FIELDS, where: `bbl=${bbl}`, limit: '1' }); record.pluto = lots[0] || null; } catch { /* A missing property source stays unavailable. */ }
    }
  }
  const [violations, contacts, acris] = await Promise.allSettled([openSnapshot(buildings), registeredContacts(buildings), acrisDocuments(record)]);
  return { record: { ...record, hpdBuildings: buildings }, checkedAt: new Date().toISOString(), buildings,
    violations: violations.status === 'fulfilled' ? violations.value : null,
    contacts: contacts.status === 'fulfilled' ? contacts.value : [],
    acris: acris.status === 'fulfilled' ? acris.value : { documents: [], note: 'ACRIS lookup failed; use the official source.' },
    errors: [violations, contacts, acris].filter(r => r.status === 'rejected').map(r => r.reason.message),
  };
}
