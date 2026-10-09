# Request audit: data and n8n setup

The browser audit processes supplied records in memory. Closing/reloading the page discards them; download the working-copy CSV to keep edits. Nothing is uploaded to a mailbox, CRM or calendar by this application. No actual customer data or demonstration customer records are committed to this repository.

## Input

CSV columns:

`id,type,reference,received_at,assignee,response_at,next_action_at,appointment_at,status,source`

Required: `id`, `type`, `received_at`, `status`. Supported types: `residential`, `multifamily`, `management`. Statuses: `new`, `contacted`, `appointment`, `won`, `closed`, `opted_out`.

Dates use ISO 8601 with an explicit offset or `Z`. IDs must be unique per import. Maximum 5,000 records and 2 MB of CSV. Unknown CSV columns are discarded. Invalid records reject the new import while retaining the previous report.

There are no synthetic data rows in the downloadable template. Populate it from actual, authorised request/activity records. Some CRM exports lack first-response information; that field requires activity-history mapping before it can support a meaningful audit.

## Rules

- Active records without an assignee need ownership review.
- Active records without a recorded first response, older than the chosen elapsed-hour target, need source-history review. This does not prove a lead was ignored.
- An explicitly recorded next action in the past needs completion/rescheduling review.
- A contacted request without a next action needs a documented next step.
- Appointment status without a date, or a date in the past without an updated outcome, needs record review.
- Closed, won and opted-out records generate no follow-up actions. A future received timestamp is a data-quality exception.

The browser edit form uses its timezone and stores dates as ISO timestamps. It changes a local working copy only. The draft is a template for manual review and is never sent by the application.

## n8n export

Export **n8n audit core** or import [request-audit-workflow.json](request-audit-workflow.json). The workflow is inactive and has no credentials, source connections, recipients or demo inputs.

Configure Header Auth credentials on the Webhook node before publishing. POST a JSON object with a `requests` array using the same fields and optional `slaHours`. The Code node validates the snapshot and returns review findings. It has no persistence and sends no messages.

Customer-specific production installation requires an authorised data source, durable state, scoped access, idempotent updates, execution-error reporting, business-hours configuration, retention policy, approved recipients/templates and an agreed calendar/task destination. Keep credentials in n8n credentials and avoid exposing production snapshots in logs longer than necessary.

The standalone core is tested locally. Import, credential configuration, webhook execution and integrations have not been tested on a deployed n8n instance because server setup was deferred.

Official n8n Webhook documentation: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/
