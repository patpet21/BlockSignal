// This module generates inactive n8n exports. It contains no credentials or customer portfolio.
export function workspaceConfig(workspaceId) {
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(workspaceId || '') || workspaceId.startsWith('REPLACE')) throw new Error('Configure this workflow workspaceId before execution.');
  return { workspaceId };
}

export function watchInput(body, workspaceId) {
  const config = workspaceConfig(workspaceId);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a watch request object.');
  const buildingId = String(body.buildingId || '');
  const action = body.action || 'watch';
  const address = String(body.address || '').trim();
  if (!/^\d{1,12}$/.test(buildingId)) throw new Error('An actual matched HPD building ID is required.');
  if (!['watch', 'pause'].includes(action)) throw new Error('Unsupported watch action.');
  if (action === 'watch' && (!address || address.length > 300 || /[\r\n\0]/.test(address))) throw new Error('Provide an address of up to 300 characters.');
  return { ...config, buildingId, address, action };
}

export function snapshotResult(response, buildingId) {
  const fail = errorCode => ({ ok: false, errorCode });
  if (response?.statusCode !== 200) return fail('source_http_error');
  const rows = response.body;
  if (!Array.isArray(rows)) return fail('invalid_response');
  if (rows.length > 1000) return fail('snapshot_overflow');
  const ids = new Set();
  const fields = ['violationid', 'buildingid', 'violationstatus', 'class', 'currentstatus', 'currentstatusdate', 'novdescription'];
  const normalized = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !/^\d+$/.test(String(row.violationid || '')) || String(row.buildingid) !== buildingId
      || row.violationstatus !== 'Open' || !/^[A-Z]{1,8}$/.test(row.class || '')) return fail('invalid_record');
    const id = String(row.violationid);
    if (ids.has(id)) return fail('duplicate_record');
    ids.add(id);
    if (fields.some(key => row[key] != null && (typeof row[key] !== 'string' || row[key].length > 10000))) return fail('invalid_record');
    normalized.push(Object.fromEntries(fields.map(key => [key, row[key] ?? null])));
  }
  return { ok: true, rows: normalized };
}

export function emailConfig(config) {
  workspaceConfig(config.workspaceId);
  for (const key of ['fromEmail', 'toEmail']) {
    if (!/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(config[key] || '') || config[key].includes('REPLACE')) throw new Error('Configure authorised internal sender and recipient before execution.');
  }
  return config;
}

export function noticeMessage(notice) {
  const p = notice.payload;
  if (!p || !Array.isArray(p.changes) || !p.changes.length) throw new Error('Invalid durable notice.');
  const clean = value => String(value ?? '').replace(/[\r\n\0]/g, ' ').slice(0, 300);
  const urgent = p.changes.some(c => c.priority === 'urgent_review');
  return {
    subject: `BlockSignal${urgent ? ' | Class C review' : ''} | ${clean(p.address)} | notice ${notice.id}`,
    text: `Property: ${clean(p.address)}\nHPD building ID: ${clean(p.buildingId)}\nObserved: ${clean(p.observedAt)}\nNotice ID: ${notice.id}\n\n` + p.changes.map(c =>
      `${clean(c.kind)} | record ${clean(c.recordId)} | class ${clean(c.class)} | ${clean(c.status)}\n${String(c.description || '').slice(0, 10000)}\nSource: https://hpdonline.nyc.gov/hpdonline/`).join('\n\n') +
      '\n\nReview the source before acting. Observation dates are not event dates. A record disappearing does not establish a completed repair. This report reflects HPD coverage only.',
  };
}

export function deliveryAccepted(response, recipient) {
  return !response?.error && Array.isArray(response?.accepted) && response.accepted.some(address => String(address).toLowerCase() === recipient.toLowerCase());
}

export function operatorMessage(error) {
  const clean = value => String(value || '').replace(/[\r\n\0]/g, ' ').slice(0, 200);
  return { subject: 'BlockSignal | automation execution failed', text: [
    'Workflow: ' + clean(error.workflow?.name), 'Execution: ' + clean(error.execution?.id),
    'Last node: ' + clean(error.execution?.lastNodeExecuted),
    'Open the private n8n execution log to investigate. Source snapshots and raw error payloads are not included.',
  ].join('\n') };
}

export function healthMessage(report) {
  const issues = Object.entries(report).filter(([key, value]) => key !== 'workspace' && value !== false && value !== 0);
  return issues.length ? { subject: 'BlockSignal | operational attention required', text: [
    'Workspace: ' + report.workspace, ...issues.map(([key, value]) => key + ': ' + value),
    'Review source failures, overdue work and undelivered notices in the private database/n8n console.',
  ].join('\n') } : null;
}

const settings = { executionOrder: 'v1', timezone: 'America/New_York', executionTimeout: 1800, saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all' };
const code = (id, name, jsCode, x, y = 0) => ({ id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position: [x, y], parameters: { jsCode } });
const pg = (id, name, query, queryReplacement, x, y = 0) => ({ id, name, type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [x, y], parameters: { operation: 'executeQuery', query, options: { queryReplacement } } });
const manual = () => ({ id: 'manual', name: 'Manual test', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 160], parameters: {} });
const schedule = (expression = '*/15 * * * *') => ({ id: 'schedule', name: 'Schedule', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 0], parameters: { rule: { interval: [{ field: 'cronExpression', expression }] } } });
const link = (node, index = 0) => ({ node, type: 'main', index });
const flow = (name, nodes, connections, note) => ({ name, active: false, nodes: [...nodes, {
  id: 'setup-note', name: 'Configure before publishing', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [200, -300],
  parameters: { width: 980, height: 210, content: note },
}], connections, settings: { ...settings }, pinData: {} });
const configCode = `const workspaceConfig=${workspaceConfig.toString()}; const config=workspaceConfig('REPLACE_WORKSPACE_ID'); return [{json:{...config,leaseToken:String($execution.id)}}];`;
const mailConfigCode = `const workspaceConfig=${workspaceConfig.toString()};const emailConfig=${emailConfig.toString()}; const config=emailConfig({workspaceId:'REPLACE_WORKSPACE_ID',fromEmail:'REPLACE_SENDER',toEmail:'REPLACE_INTERNAL_RECIPIENT'});return [{json:{...config,leaseToken:String($execution.id)}}];`;
const smtp = (name, x, y = 0) => ({ id: name.toLowerCase().replaceAll(' ', '-'), name, type: 'n8n-nodes-base.emailSend', typeVersion: 2.1, position: [x, y],
  parameters: { operation: 'send', fromEmail: "={{ $('Configuration').first().json.fromEmail }}", toEmail: "={{ $('Configuration').first().json.toEmail }}", subject: '={{ $json.subject }}', emailFormat: 'text', text: '={{ $json.text }}', options: { appendAttribution: false } } });
const loop = (name, x) => ({ id: name.toLowerCase().replaceAll(' ', '-'), name, type: 'n8n-nodes-base.splitInBatches', typeVersion: 3, position: [x, 0], parameters: { batchSize: 1, options: {} } });

export function buildAutomationWorkflows() {
  const watch = flow('BlockSignal 01 | Register or pause a watched property', [
    { id: 'watch', name: 'Authenticated server request', type: 'n8n-nodes-base.webhook', typeVersion: 2.1, position: [0, 0], parameters: { httpMethod: 'POST', path: 'blocksignal/property-watch', authentication: 'headerAuth', responseMode: 'lastNode', options: {} } },
    code('validate', 'Validate authorised workspace and input', `const workspaceConfig=${workspaceConfig.toString()};const watchInput=${watchInput.toString()};return [{json:watchInput($input.first().json.body,'REPLACE_WORKSPACE_ID')}];`, 260),
    pg('register', 'Persist watch configuration', 'SELECT blocksignal.watch_property($1,$2,$3,$4) AS result;', '={{ [$json.workspaceId,$json.buildingId,$json.address,$json.action] }}', 520),
  ], {
    'Authenticated server request': { main: [[link('Validate authorised workspace and input')]] },
    'Validate authorised workspace and input': { main: [[link('Persist watch configuration')]] },
  }, '## Private server endpoint\nAssign Header Auth and a dedicated Postgres credential. Set the fixed authorised workspace ID in the validator. Import automation/schema.sql first. An authenticated server gateway can call this endpoint when an app property is saved. No public-browser credentials, CSV ingestion or customer messages. App gateway integration is not installed by this export.');

  const collector = flow('BlockSignal 02 | Collect HPD changes into a durable outbox', [
    schedule(), manual(), code('configuration', 'Configuration', configCode, 220),
    pg('claim', 'Claim up to ten due properties', 'SELECT * FROM blocksignal.claim_checks($1,$2);', '={{ [$json.workspaceId,$json.leaseToken] }}', 460),
    loop('Next property', 700),
    code('url', 'Build source request', `const p=$input.first().json; const params={'$where':"buildingid='"+p.building_id+"' AND violationstatus='Open'",'$limit':'1001','$order':'violationid ASC'};return [{json:{...p,url:'https://data.cityofnewyork.us/resource/wvxf-dwi5.json?'+Object.entries(params).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&')}}];`, 940),
    { id: 'source', name: 'Fetch HPD open snapshot', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1180, 0], retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, onError: 'continueErrorOutput', parameters: { url: '={{ $json.url }}', options: { timeout: 45000, response: { response: { responseFormat: 'json', fullResponse: true } } } } },
    code('normalize', 'Validate complete snapshot', `const snapshotResult=${snapshotResult.toString()};const p=$('Next property').item.json;return [{json:{...p,result:snapshotResult($input.first().json,p.building_id)}}];`, 1420),
    code('failure', 'Record source failure', `const p=$('Next property').item.json;return [{json:{...p,result:{ok:false,errorCode:'source_request_failed'}}}];`, 1420, 220),
    pg('commit', 'Commit snapshot and pending alerts atomically', 'SELECT blocksignal.commit_check($1,$2,$3,$4::jsonb) AS result;', '={{ [$json.workspace,$json.building_id,$json.lease_token,JSON.stringify($json.result)] }}', 1680),
  ], {
    'Schedule': { main: [[link('Configuration')]] }, 'Manual test': { main: [[link('Configuration')]] },
    'Configuration': { main: [[link('Claim up to ten due properties')]] },
    'Claim up to ten due properties': { main: [[link('Next property')]] },
    'Next property': { main: [[], [link('Build source request')]] },
    'Build source request': { main: [[link('Fetch HPD open snapshot')]] },
    'Fetch HPD open snapshot': { main: [[link('Validate complete snapshot')], [link('Record source failure')]] },
    'Validate complete snapshot': { main: [[link('Commit snapshot and pending alerts atomically')]] },
    'Record source failure': { main: [[link('Commit snapshot and pending alerts atomically')]] },
    'Commit snapshot and pending alerts atomically': { main: [[link('Next property')]] },
  }, '## Collector\nSet workspaceId and Postgres credentials. Each property is due every 24 hours; the worker claims up to ten every 15 minutes. Expiring DB leases isolate overlapping workers. First successful snapshot is a baseline. Invalid, failed or >1,000-record responses retain it. Three source failures create one outage notice; recovery is recorded. Assign workflow 04 as the error workflow after import.');

  const send = smtp('Send internal notice', 1180); send.onError = 'continueErrorOutput';
  const notifier = flow('BlockSignal 03 | Deliver pending internal notices', [
    schedule('*/5 * * * *'), manual(), code('configuration', 'Configuration', mailConfigCode, 220),
    pg('claim', 'Claim pending notices', 'SELECT * FROM blocksignal.claim_notices($1,$2);', '={{ [$json.workspaceId,$json.leaseToken] }}', 460), loop('Next notice', 700),
    code('message', 'Build evidence-linked email', `const noticeMessage=${noticeMessage.toString()};const n=$input.first().json;return [{json:{...n,...noticeMessage(n)}}];`, 940), send,
    code('accepted', 'SMTP accepted', `const deliveryAccepted=${deliveryAccepted.toString()};const n=$('Next notice').item.json;return [{json:{...n,sent:deliveryAccepted($input.first().json,$('Configuration').first().json.toEmail)}}];`, 1420),
    code('failed', 'Delivery needs retry', `const n=$('Next notice').item.json;return [{json:{...n,sent:false}}];`, 1420, 220),
    pg('finish', 'Persist delivery result', 'SELECT blocksignal.finish_notice($1,$2::bigint,$3,$4::boolean) AS result;', '={{ [$json.workspace,$json.id,$json.lease_token,$json.sent] }}', 1680),
  ], {
    'Schedule': { main: [[link('Configuration')]] }, 'Manual test': { main: [[link('Configuration')]] },
    'Configuration': { main: [[link('Claim pending notices')]] }, 'Claim pending notices': { main: [[link('Next notice')]] },
    'Next notice': { main: [[], [link('Build evidence-linked email')]] },
    'Build evidence-linked email': { main: [[link('Send internal notice')]] },
    'Send internal notice': { main: [[link('SMTP accepted')], [link('Delivery needs retry')]] },
    'SMTP accepted': { main: [[link('Persist delivery result')]] }, 'Delivery needs retry': { main: [[link('Persist delivery result')]] },
    'Persist delivery result': { main: [[link('Next notice')]] },
  }, '## Internal delivery\nSet the same workspace ID, an authorised internal sender/recipient, SMTP and Postgres credentials. Notices survive collector success and mail failure. Five bounded delivery attempts; exhausted notices remain in the database for operator review. SMTP acceptance is not inbox delivery. A timeout/crash after sending can duplicate a notice: use its stable notice ID. This is at-least-once delivery, not exactly-once. Test in your own inbox before publishing.');

  const errors = flow('BlockSignal 04 | Operator execution errors', [
    { id: 'error', name: 'Execution error', type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    code('configuration', 'Configuration', mailConfigCode, 220),
    code('message', 'Prepare operator incident', `const operatorMessage=${operatorMessage.toString()};return [{json:operatorMessage($('Execution error').first().json)}];`, 460), smtp('Notify operator', 700),
  ], {
    'Execution error': { main: [[link('Configuration')]] }, 'Configuration': { main: [[link('Prepare operator incident')]] }, 'Prepare operator incident': { main: [[link('Notify operator')]] },
  }, '## Operator channel\nSet sender/operator recipient and SMTP credentials. Select this imported workflow in the other workflows’ Error workflow setting. Expected source and delivery failures are handled in their durable queues; this handler reports unexpected execution failures. Do not select this workflow as its own error handler. It cannot alert if the whole n8n host or its SMTP channel is down.');

  const health = flow('BlockSignal 05 | Daily operational health report', [
    schedule('0 8 * * *'), manual(), code('configuration', 'Configuration', mailConfigCode, 220),
    pg('health', 'Read collector and delivery health', 'SELECT blocksignal.health_report($1) AS report;', '={{ [$json.workspaceId] }}', 460),
    code('message', 'Report actionable issues only', `const healthMessage=${healthMessage.toString()};const message=healthMessage($input.first().json.report);return message?[{json:message}]:[];`, 700), smtp('Notify operator', 940),
  ], {
    'Schedule': { main: [[link('Configuration')]] }, 'Manual test': { main: [[link('Configuration')]] },
    'Configuration': { main: [[link('Read collector and delivery health')]] }, 'Read collector and delivery health': { main: [[link('Report actionable issues only')]] },
    'Report actionable issues only': { main: [[link('Notify operator')]] },
  }, '## Operational checks\nSet workspace ID, operator sender/recipient, SMTP and Postgres credentials. Daily at 08:00 New York; no message when healthy. A separate external uptime/heartbeat monitor is still required to detect a dead host, a failed schedule or simultaneous database/SMTP outage. Assign workflow 04 as the error workflow.');
  return { watch, collector, notifier, errors, health };
}
