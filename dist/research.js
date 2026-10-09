export const VIOLATIONS_SOURCE = 'https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Violations/wvxf-dwi5';
export const CONTACTS_SOURCE = 'https://data.cityofnewyork.us/Housing-Development/Registration-Contacts/feu5-w2e2';
export const SERVICE_TERMS = {
  heat: ['HEAT', 'HOT WATER'],
  pest: ['MICE', 'ROACH', 'RODENT', 'RAT HARBORAGE'],
  paint: ['PAINT', 'PLASTER'],
};
const BOROUGHS = ['BROOKLYN', 'MANHATTAN', 'QUEENS', 'BRONX', 'STATEN ISLAND'];

export function buildWhere({ boro, service, zip = '' }, now = new Date()) {
  if (!BOROUGHS.includes(boro)) throw new Error('Select a valid borough.');
  if (service !== 'all' && !SERVICE_TERMS[service]) throw new Error('Select a valid service.');
  if (zip && !/^\d{5}$/.test(zip)) throw new Error('Enter a five-digit ZIP code.');
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  let where = `violationstatus='Open' AND boro='${boro}' AND approveddate>='${cutoff.toISOString().slice(0, 10)}T00:00:00'`;
  if (zip) where += ` AND zip='${zip}'`;
  if (SERVICE_TERMS[service]) where += ' AND (' + SERVICE_TERMS[service].map(term => `upper(novdescription) like '%${term}%'`).join(' OR ') + ')';
  return where;
}

export function groupedQuery(where, limit = 100) {
  return {
    select: 'buildingid,registrationid,boro,housenumber,streetname,zip,count(*) as total,sum(case(class="C",1,true,0)) as class_c,max(approveddate) as latest',
    where, group: 'buildingid,registrationid,boro,housenumber,streetname,zip',
    order: 'total DESC', limit: String(limit),
  };
}

export function datasetUrl(dataset, params) {
  const url = new URL(`https://data.cityofnewyork.us/resource/${dataset}.json`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set('$' + key, value));
  return url;
}

export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function csv(rows) {
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function contactName(contact) {
  return contact.corporationname || [contact.firstname, contact.lastname].filter(Boolean).join(' ') || 'Name unavailable';
}

export function contactAddress(contact) {
  return [contact.businesshousenumber, contact.businessstreetname, contact.businessapartment, contact.businesscity, contact.businessstate, contact.businesszip].filter(Boolean).join(' ');
}

export function shortlistCsv(entries) {
  const header = ['origin', 'saved_at', 'borough', 'service', 'building_id', 'registration_id', 'address', 'zip', 'matching_open_records', 'matching_class_c', 'latest_approval', 'qualification_status', 'notes', 'registered_contacts', 'violations_source', 'contacts_source'];
  const rows = entries.map(item => {
    const r = item.record;
    return ['NYC HPD', item.savedAt, r.boro, item.context.serviceLabel, r.buildingid, r.registrationid, `${r.housenumber} ${r.streetname}`, r.zip, r.total, r.class_c, r.latest, item.status, item.notes, (item.contacts || []).map(c => `${contactName(c)} (${c.type || ''}) — ${contactAddress(c)}`).join(' | '), VIOLATIONS_SOURCE, CONTACTS_SOURCE];
  });
  return csv([header, ...rows]);
}
