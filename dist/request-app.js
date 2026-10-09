import { csv } from './research.js';
import { REQUEST_COLUMNS, REQUEST_TYPES, parseRequestCSV, auditRequests, requestDraft, requestAuditWorkflow } from './request-audit.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = value => value ? new Date(value).toLocaleString('en-US') : 'Not recorded';
let input = [], report = null, selectedId = null;
function download(name, body, type) { const url = URL.createObjectURL(new Blob([body], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function render() {
  if (!report) return;
  $('count-total').textContent = report.totals.requests; $('count-review').textContent = report.totals.review; $('count-response').textContent = report.totals.responseUnrecorded; $('count-appointments').textContent = report.totals.appointments;
  $('audit-time').textContent = 'Audited ' + when(report.auditedAt);
  $('export-actions').disabled = false; $('export-records').disabled = false;
  const visible = report.requests.filter(row => ($('type-filter').value === 'all' || row.type === $('type-filter').value) && (!$('review-only').checked || row.flags.length)).sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at));
  $('queue').innerHTML = visible.length ? visible.map(row => `<article class="request-card"><div class="request-top"><div><h3>${esc(row.reference || row.id)}</h3><p>${esc(REQUEST_TYPES[row.type])} · received ${esc(when(row.received_at))}<br>Responsible: ${esc(row.assignee || 'Not recorded')} · status: ${esc(row.status)} · source: ${esc(row.source || 'Not recorded')}</p></div><button class="ghost" data-request="${esc(row.id)}">Review request ↗</button></div><div class="flag-list">${row.flags.length ? row.flags.map(flag => `<span class="flag">${esc(flag.label)}</span>`).join('') : '<span class="flag clean">No gaps detected by these rules</span>'}</div>${row.flags.length ? `<p class="next-step">${esc(row.flags[0].next)}</p>` : ''}</article>`).join('') : '<div class="empty">No requests match these filters.<small>A clear queue reflects the supplied records and rules; missing source history still needs checking.</small></div>';
}
function localDate(value) { if (!value) return ''; const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19); }
function isoDate(value) { return value ? new Date(value).toISOString() : ''; }
$('template').onclick = () => download('blocksignal-request-template.csv', csv([REQUEST_COLUMNS]), 'text/csv;charset=utf-8');
$('csv-file').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  try { if (file.size > 2000000) throw new Error('Use a CSV smaller than 2 MB.'); $('csv-input').value = await file.text(); $('import-status').textContent = 'File loaded. Review the source fields, then run the audit.'; }
  catch (error) { $('import-status').textContent = error.message; }
};
$('audit-form').onsubmit = event => {
  event.preventDefault();
  try { const nextInput = parseRequestCSV($('csv-input').value), nextReport = auditRequests(nextInput, { slaHours: $('sla-hours').value }); input = nextReport.requests.map(row => Object.fromEntries(REQUEST_COLUMNS.map(key => [key, row[key]]))); report = nextReport; render(); $('import-status').textContent = `${report.totals.requests} records audited. ${report.totals.review} need review. Results reflect the supplied history; no lost revenue has been inferred.`; $('review').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  catch (error) { $('import-status').textContent = error.message + (report ? ' Previous results have been retained.' : ''); }
};
$('type-filter').onchange = render; $('review-only').onchange = render;
$('queue').onclick = event => {
  const button = event.target.closest('[data-request]'); if (!button) return;
  const row = report.requests.find(r => r.id === button.dataset.request); if (!row) return;
  selectedId = row.id; $('detail-title').textContent = row.reference || row.id; $('detail-source').textContent = `ID ${row.id} · ${row.source || 'Source not recorded'} · received ${when(row.received_at)}`;
  $('detail-flags').textContent = row.flags.map(flag => `${flag.label}: ${flag.next}`).join('\n');
  $('edit-assignee').value = row.assignee; $('edit-status').value = row.status; $('edit-response').value = localDate(row.response_at); $('edit-next').value = localDate(row.next_action_at); $('edit-appointment').value = localDate(row.appointment_at);
  $('edit-timezone').textContent = 'Edit dates in this browser’s timezone: ' + Intl.DateTimeFormat().resolvedOptions().timeZone;
  const draft = requestDraft(row); $('reply-draft').value = draft || 'First-reply draft suppressed for this record. Review existing history in your working system.'; $('download-draft').disabled = !draft; $('edit-error').textContent = ''; $('request-detail').showModal();
};
$('close-detail').onclick = () => $('request-detail').close();
$('edit-request').onsubmit = event => {
  event.preventDefault();
  try { const updated = input.map(row => row.id === selectedId ? { ...row, assignee: $('edit-assignee').value, status: $('edit-status').value, response_at: isoDate($('edit-response').value), next_action_at: isoDate($('edit-next').value), appointment_at: isoDate($('edit-appointment').value) } : row); const next = auditRequests(updated, { slaHours: report.slaHours }); input = updated; report = next; render(); $('request-detail').close(); $('import-status').textContent = 'Working copy updated locally. Export it to keep these edits; your source CRM has not been changed.'; }
  catch (error) { $('edit-error').textContent = error.message; }
};
$('download-draft').onclick = () => download('blocksignal-reply-draft.txt', $('reply-draft').value, 'text/plain;charset=utf-8');
$('export-records').onclick = () => download('blocksignal-request-working-copy.csv', csv([REQUEST_COLUMNS, ...input.map(row => REQUEST_COLUMNS.map(key => row[key]))]), 'text/csv;charset=utf-8');
$('export-actions').onclick = () => download('blocksignal-request-review.csv', csv([['request_id', 'reference', 'type', 'assignee', 'status', 'source', 'received_at', 'response_at', 'next_action_at', 'appointment_at', 'review_flags', 'review_actions', 'audited_at'], ...report.requests.filter(row => row.flags.length).map(row => [row.id, row.reference, row.type, row.assignee, row.status, row.source, row.received_at, row.response_at, row.next_action_at, row.appointment_at, row.flags.map(f => f.label).join(' | '), row.flags.map(f => f.next).join(' | '), report.auditedAt])]), 'text/csv;charset=utf-8');
$('export-audit-workflow').onclick = () => { download('blocksignal-n8n-request-audit.json', JSON.stringify(requestAuditWorkflow(), null, 2), 'application/json'); $('workflow-status').textContent = 'Inactive audit core exported. Configure Header Auth and the client’s authorised data connections before publishing. No messages have been sent.'; };
