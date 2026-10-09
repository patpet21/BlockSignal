export const REQUEST_COLUMNS = ['id', 'type', 'reference', 'received_at', 'assignee', 'response_at', 'next_action_at', 'appointment_at', 'status', 'source'];
export const REQUEST_TYPES = { residential: 'Residential agency', multifamily: 'Multifamily brokerage', management: 'Property management enquiries' };
export const REQUEST_STATUSES = ['new', 'contacted', 'appointment', 'won', 'closed', 'opted_out'];

export function parseRequestCSV(text) {
  if (typeof text !== 'string' || text.length > 2000000) throw new Error('Use a CSV smaller than 2 MB.');
  const rows = []; let row = [], cell = '', quoted = false, closedQuote = false;
  const finishCell = () => { row.push(cell); cell = ''; closedQuote = false; };
  const finishRow = () => { finishCell(); if (row.some(value => value.trim())) rows.push(row); row = []; if (rows.length > 5001) throw new Error('Maximum 5,000 requests per audit.'); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closedQuote = true; }
      else cell += c;
    } else if (c === ',') finishCell();
    else if (c === '\r' || c === '\n') { if (c === '\r' && text[i + 1] === '\n') i++; finishRow(); }
    else if (closedQuote) { if (!/\s/.test(c)) throw new Error('Unexpected characters after a quoted CSV field.'); }
    else if (c === '"') { if (cell) throw new Error('Unexpected quote in a CSV field.'); quoted = true; }
    else cell += c;
  }
  if (quoted) throw new Error('An unfinished quoted field was found.');
  if (cell || row.length || closedQuote) finishRow();
  if (!rows.length) throw new Error('Paste or upload your request records first.');
  const headers = rows.shift().map(value => value.replace(/^\uFEFF/, '').trim().toLowerCase());
  if (new Set(headers).size !== headers.length) throw new Error('CSV headers must be unique.');
  for (const key of ['id', 'type', 'received_at', 'status']) if (!headers.includes(key)) throw new Error('Missing CSV column: ' + key);
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${index + 2} has a different number of fields from the header.`);
    return Object.fromEntries(headers.map((key, i) => [key, values[i]]).filter(([key]) => REQUEST_COLUMNS.includes(key)));
  });
}

export function normalizeRequests(input) {
  if (!Array.isArray(input) || !input.length || input.length > 5000) throw new Error('Provide between 1 and 5,000 requests.');
  const ids = new Set();
  return input.map((raw, i) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Request ${i + 1} must be an object.`);
    const row = Object.fromEntries(REQUEST_COLUMNS.map(key => [key, String(raw[key] ?? '').trim()]));
    if (!row.id || row.id.length > 120) throw new Error(`Request ${i + 1} needs a unique ID of at most 120 characters.`);
    if (ids.has(row.id)) throw new Error('Duplicate request ID: ' + row.id + '. Merge repeated exports before auditing.');
    ids.add(row.id);
    if (!Object.hasOwn(REQUEST_TYPES, row.type)) throw new Error(`Request ${row.id}: type must be residential, multifamily or management.`);
    if (!REQUEST_STATUSES.includes(row.status)) throw new Error(`Request ${row.id}: use a documented status.`);
    if (Object.values(row).some(value => value.length > 400)) throw new Error(`Request ${row.id}: fields must be at most 400 characters.`);
    for (const key of ['received_at', 'response_at', 'next_action_at', 'appointment_at']) {
      if (!row[key] && key !== 'received_at') continue;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(row[key]) || !Number.isFinite(Date.parse(row[key]))) throw new Error(`Request ${row.id}: ${key} needs an ISO date/time with a timezone, e.g. 2026-10-09T09:00:00-04:00.`);
      const [year, month, day] = row[key].slice(0, 10).split('-').map(Number), calendar = new Date(0);
      calendar.setUTCFullYear(year, month - 1, day);
      if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day || Number(row[key].slice(11, 13)) > 23) throw new Error(`Request ${row.id}: ${key} is not a real calendar date/time.`);
    }
    if (row.response_at && Date.parse(row.response_at) < Date.parse(row.received_at)) throw new Error(`Request ${row.id}: response_at precedes received_at.`);
    return row;
  });
}

export function auditRequests(input, { slaHours = 2, now = new Date().toISOString() } = {}) {
  const target = Number(slaHours), time = Date.parse(now);
  if (!Number.isFinite(target) || target < 0.25 || target > 168) throw new Error('Choose a response target between 0.25 and 168 hours.');
  if (!Number.isFinite(time)) throw new Error('Invalid audit time.');
  const requests = normalizeRequests(input);
  const audited = requests.map(row => {
    const flags = [], closed = ['won', 'closed', 'opted_out'].includes(row.status), received = Date.parse(row.received_at);
    if (received > time) flags.push({ code: 'future_record', label: 'Received time is in the future', next: 'Check the source timestamp and timezone.' });
    if (row.response_at && Date.parse(row.response_at) > time) flags.push({ code: 'future_response', label: 'Recorded response time is in the future', next: 'Verify the response history and source timestamp.' });
    if (!closed && received <= time) {
      if (!row.assignee) flags.push({ code: 'unassigned', label: 'No responsible person recorded', next: 'Assign a responsible person in your working system.' });
      if (!row.response_at && time - received >= target * 3600000) flags.push({ code: 'response_unrecorded', label: 'First response not recorded within your target', next: 'Check email/call history before deciding whether a response is needed.' });
      if (row.next_action_at && Date.parse(row.next_action_at) < time) flags.push({ code: 'action_due', label: 'Recorded next action is overdue', next: 'Complete, reschedule or close the recorded action.' });
      if (row.status === 'contacted' && !row.next_action_at) flags.push({ code: 'next_step_missing', label: 'Contacted request has no next action recorded', next: 'Record the agreed next step or close the request.' });
      if (row.status === 'appointment' && !row.appointment_at) flags.push({ code: 'appointment_date_missing', label: 'Appointment has no date recorded', next: 'Confirm and record the appointment date.' });
      if (row.status === 'appointment' && row.appointment_at && Date.parse(row.appointment_at) < time) flags.push({ code: 'appointment_outcome', label: 'Appointment date passed; outcome not recorded', next: 'Record the outcome, next step or rescheduled date.' });
    }
    return { ...row, flags, ageHours: Math.max(0, (time - received) / 3600000), closed };
  });
  return { auditedAt: new Date(time).toISOString(), slaHours: target, requests: audited, totals: {
    requests: audited.length, active: audited.filter(r => !r.closed).length,
    review: audited.filter(r => r.flags.length).length,
    responseUnrecorded: audited.filter(r => r.flags.some(f => f.code === 'response_unrecorded')).length,
    appointments: audited.filter(r => r.status === 'appointment').length,
    won: audited.filter(r => r.status === 'won').length,
  } };
}

export function requestDraft(row) {
  if (['won', 'closed', 'opted_out'].includes(row.status) || row.response_at) return '';
  const intro = {
    residential: 'Thanks for your property enquiry. Are you looking to buy, sell or arrange a viewing?',
    multifamily: 'Thanks for your multifamily enquiry. Please confirm the property or area you are interested in and whether you are buying or selling.',
    management: 'Thanks for your property management enquiry. Please share the property location, number of units and the services you would like to discuss.',
  }[row.type];
  return intro + '\n\nWhat time would suit you for a short conversation?\n\n[Your name / business]';
}

export function requestAuditWorkflow() {
  const code = `const REQUEST_COLUMNS=${JSON.stringify(REQUEST_COLUMNS)};const REQUEST_TYPES=${JSON.stringify(REQUEST_TYPES)};const REQUEST_STATUSES=${JSON.stringify(REQUEST_STATUSES)};const normalizeRequests=${normalizeRequests.toString()};const auditRequests=${auditRequests.toString()};const input=$input.first().json.body;return [{json:auditRequests(input?.requests,{slaHours:input?.slaHours??2})}];`;
  return { name: 'BlockSignal — request snapshot audit', active: false, nodes: [
    { id: 'intake', name: 'Authenticated snapshot input', type: 'n8n-nodes-base.webhook', typeVersion: 2.1, position: [0, 0], parameters: { httpMethod: 'POST', path: 'blocksignal-request-audit', authentication: 'headerAuth', responseMode: 'lastNode', options: {} } },
    { id: 'audit', name: 'Review actual request records', type: 'n8n-nodes-base.code', typeVersion: 2, position: [280, 0], parameters: { jsCode: code } },
    { id: 'notes', name: 'Setup required', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, -240], parameters: { width: 700, height: 200, content: '## Snapshot audit core\nInactive export. Configure Header Auth credentials before publishing. POST {requests:[...],slaHours:2}; use the documented fields. No contacts, CRM, mailbox or calendar are connected. No messages are sent. Missing response history is flagged for review, not asserted to be an ignored lead. Customer-specific ingestion, persistence, task creation and delivery must be configured in an authorised client installation.' } },
  ], connections: { 'Authenticated snapshot input': { main: [[{ node: 'Review actual request records', type: 'main', index: 0 }]] } }, settings: { executionOrder: 'v1', timezone: 'America/New_York' }, pinData: {} };
}
