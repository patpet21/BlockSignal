import { buildWhere, groupedQuery, datasetUrl, csv, shortlistCsv, contactName, contactAddress, VIOLATIONS_SOURCE } from './research.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const date = value => value ? new Date(value).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '—';
const STORAGE_KEY = 'blocksignal-shortlist-v1';
const QUALIFICATIONS = ['Needs review', 'Relevant — contact unverified', 'Relevant — contact verified', 'Not a fit'];
let records = [], context = {}, isDemo = false, searching = false, detailRequest = 0, currentDetail = null, shortlist = [];
try {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (Array.isArray(stored)) shortlist = stored.filter(item => item?.record?.buildingid && item.context).map(item => ({ ...item, status: QUALIFICATIONS.includes(item.status) ? item.status : QUALIFICATIONS[0], notes: String(item.notes || '') }));
} catch { $('saved-status').textContent = 'Browser storage is unavailable or could not be read. Export your shortlist before closing.'; }

async function api(dataset, params) {
  const response = await fetch(datasetUrl(dataset, params), { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`NYC Open Data returned HTTP ${response.status}.`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Unexpected response from NYC Open Data.');
  return data;
}

function saveShortlist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(shortlist)); $('saved-status').textContent = 'Shortlist saved on this browser.'; }
  catch { $('saved-status').textContent = 'Could not save to browser storage. Export your shortlist before closing.'; }
}

function renderResults() {
  $('rows').innerHTML = records.length ? records.map((record, index) => `<tr><td><b>${esc(record.housenumber)} ${esc(record.streetname)}</b><small>${esc(record.boro)} · ${esc(record.zip)} · ID ${esc(record.buildingid)}</small></td><td class="count">${esc(record.total)}</td><td><span class="danger">${esc(record.class_c)}</span></td><td>${date(record.latest)}</td><td><button class="ghost" data-index="${index}">Review ↗</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">No buildings matched these filters. Try another ZIP code or service.</td></tr>';
  $('export').disabled = !records.length;
  $('detail').hidden = true;
  currentDetail = null;
  detailRequest++;
}

function renderShortlist() {
  $('export-shortlist').disabled = !shortlist.length;
  $('saved-list').innerHTML = shortlist.length ? shortlist.map((item, index) => `<article class="saved-item"><div class="saved-heading"><div><h3>${esc(item.record.housenumber)} ${esc(item.record.streetname)}</h3><p>${esc(item.record.boro)} · ${esc(item.context.serviceLabel)} · ${esc(item.record.total)} matching records at time of search · saved ${date(item.savedAt)}</p></div><button class="ghost" data-remove="${index}">Remove</button></div><div class="saved-fields"><label>Qualification<select data-qualification="${index}">${QUALIFICATIONS.map(value => `<option${item.status === value ? ' selected' : ''}>${esc(value)}</option>`).join('')}</select></label><label>Research notes<textarea data-notes="${index}" placeholder="Why is this relevant? What did you verify? What is the next step?">${esc(item.notes)}</textarea></label></div><small>${item.contacts?.length ? `${item.contacts.length} registered contact(s) included in export. Verify they are current.` : 'No registered contacts loaded for this saved building.'}</small></article>`).join('') : '<div class="empty">No buildings saved yet.<small>Review a search result, then add it to your shortlist.</small></div>';
}

$('search').addEventListener('submit', async event => {
  event.preventDefault();
  if (searching) return;
  const nextContext = { boro: $('boro').value, service: $('service').value, serviceLabel: $('service').selectedOptions[0].text, zip: $('zip').value.trim(), searchedAt: new Date().toISOString() };
  let where;
  try { where = buildWhere(nextContext); } catch (error) { $('status').textContent = error.message; return; }
  searching = true;
  $('run').disabled = true;
  $('demo').disabled = true;
  $('status').textContent = 'Loading matching HPD records…';
  try {
    const data = await api('wvxf-dwi5', groupedQuery(where));
    records = data; context = { ...nextContext, where }; isDemo = false;
    renderResults();
    $('status').textContent = `${records.length} buildings · real NYC data · fetched ${new Date().toLocaleString('en-US')}`;
  } catch (error) { $('status').textContent = `Search failed. Previous results, if any, remain unchanged. ${error.message} Try again or use the example.`; }
  finally { searching = false; $('run').disabled = false; $('demo').disabled = false; }
});

$('demo').onclick = () => {
  isDemo = true; context = { boro: 'DEMO', serviceLabel: 'Illustrative example' };
  records = [{ buildingid: 'DEMO-01', boro: 'BROOKLYN — FICTIONAL', housenumber: '120', streetname: 'EXAMPLE AVENUE', zip: '11206', total: '12', class_c: '3', latest: '2026-09-18' }, { buildingid: 'DEMO-02', boro: 'BROOKLYN — FICTIONAL', housenumber: '45', streetname: 'SAMPLE STREET', zip: '11221', total: '8', class_c: '1', latest: '2026-09-12' }];
  renderResults();
  $('status').textContent = 'Illustrative example. Fictional addresses, not real prospects.';
};

$('rows').onclick = async event => {
  const button = event.target.closest('[data-index]');
  if (!button) return;
  const record = records[Number(button.dataset.index)], box = $('detail'), request = ++detailRequest;
  currentDetail = null;
  box.hidden = false;
  box.innerHTML = `<h2>${esc(record.housenumber)} ${esc(record.streetname)}</h2><p>${isDemo ? 'Fictional example. This building cannot be added to your real shortlist.' : 'Loading registered contacts and matching records…'}</p>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (isDemo) return;
  const detailContext = { ...context };
  const [contactResult, violationResult] = await Promise.allSettled([
    /^\d+$/.test(record.registrationid || '') ? api('feu5-w2e2', { where: `registrationid='${record.registrationid}'`, limit: '30' }) : Promise.resolve([]),
    api('wvxf-dwi5', { where: `${detailContext.where} AND buildingid='${record.buildingid}'`, order: 'approveddate DESC', limit: '5' }),
  ]);
  if (request !== detailRequest) return;
  const contacts = contactResult.status === 'fulfilled' ? contactResult.value : [];
  const violations = violationResult.status === 'fulfilled' ? violationResult.value : [];
  currentDetail = { record: { ...record }, context: detailContext, contacts };
  box.innerHTML = `<div class="detail-heading"><h2>${esc(record.housenumber)} ${esc(record.streetname)}</h2><button id="save-building">${shortlist.some(item => item.record.buildingid === record.buildingid) ? 'Update saved research' : '+ Add to shortlist'}</button></div><p><a href="https://hpdonline.nyc.gov/hpdonline/" target="_blank" rel="noopener">Verify on HPD Online ↗</a> · Building ID ${esc(record.buildingid)}</p><h3>Registered owner / agent information</h3>${contactResult.status === 'rejected' ? '<p>Contact lookup failed. You can save the building and verify contacts manually.</p>' : contacts.length ? contacts.map(contact => `<p><b>${esc(contactName(contact))}</b> · ${esc(contact.type)}<br>${esc(contactAddress(contact))}</p>`).join('') : '<p>No contacts were found for this registration.</p>'}<h3>Latest 5 matching open records</h3>${violationResult.status === 'rejected' ? '<p>Record details could not be loaded. Check HPD Online before qualifying this building.</p>' : violations.map(violation => `<p><b>Class ${esc(violation.class)} · approved ${date(violation.approveddate)}</b><br>${esc(violation.novdescription)}</p>`).join('') || '<p>No matching record details are currently available.</p>'}<p class="note">The registered mailing address is not a verified commercial contact channel. Confirm the contact and the record status before taking action.</p>`;
};

$('detail').onclick = event => {
  if (!event.target.closest('#save-building') || !currentDetail) return;
  const existing = shortlist.findIndex(item => item.record.buildingid === currentDetail.record.buildingid);
  const previous = existing >= 0 ? shortlist[existing] : null;
  const item = { ...currentDetail, savedAt: new Date().toISOString(), status: previous?.status || QUALIFICATIONS[0], notes: previous?.notes || '' };
  if (existing >= 0) { if (!item.contacts.length && previous.contacts?.length) item.contacts = previous.contacts; shortlist[existing] = item; }
  else shortlist.push(item);
  saveShortlist(); renderShortlist();
  event.target.textContent = 'Saved — update research';
};

$('saved-list').addEventListener('input', event => {
  const index = event.target.dataset.notes;
  if (index === undefined) return;
  shortlist[Number(index)].notes = event.target.value; saveShortlist();
});
$('saved-list').addEventListener('change', event => {
  const index = event.target.dataset.qualification;
  if (index === undefined) return;
  shortlist[Number(index)].status = event.target.value; saveShortlist();
});
$('saved-list').onclick = event => {
  const button = event.target.closest('[data-remove]');
  if (!button) return;
  const index = Number(button.dataset.remove), removed = shortlist.splice(index, 1)[0];
  saveShortlist(); renderShortlist();
  $('saved-status').textContent = 'Building removed. ';
  const undo = document.createElement('button'); undo.className = 'ghost'; undo.textContent = 'Undo';
  undo.onclick = () => { shortlist.splice(Math.min(index, shortlist.length), 0, removed); saveShortlist(); renderShortlist(); };
  $('saved-status').append(undo);
};

function download(name, content) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export').onclick = () => {
  const header = ['origin', 'searched_at', 'borough', 'service', 'building_id', 'registration_id', 'address', 'zip', 'matching_open_records', 'matching_class_c', 'latest_approval', 'source'];
  const rows = records.map(record => [isDemo ? 'FICTIONAL DEMO' : 'NYC HPD', context.searchedAt || '', context.boro, context.serviceLabel, record.buildingid, record.registrationid, `${record.housenumber} ${record.streetname}`, record.zip, record.total, record.class_c, record.latest, VIOLATIONS_SOURCE]);
  download(`blocksignal-${isDemo ? 'DEMO' : 'results'}-${new Date().toISOString().slice(0, 10)}.csv`, csv([header, ...rows]));
};
$('export-shortlist').onclick = () => download(`blocksignal-shortlist-${new Date().toISOString().slice(0, 10)}.csv`, shortlistCsv(shortlist));
renderShortlist();
