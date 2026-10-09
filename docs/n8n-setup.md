# BlockSignal n8n monitor

For the new database-backed implementation, use [automation/README.md](../automation/README.md). It contains five inactive workflows, a PostgreSQL migration, a durable event/outbox design, source and delivery retries, operator errors and health reporting. App gateway integration, credentials and real n8n execution tests remain to be configured. The small static-state export described below is retained as the original prototype.

This integration is prepared for import. It is not connected to any n8n instance or notification service. The user deferred server setup.

[example-portfolio-monitor.json](example-portfolio-monitor.json) is an inactive example exported from the browser and checked locally. It contains the real public HPD ID `877800` for `854 MYRTLE AVENUE`, not your customer portfolio. Export your own saved properties before enabling a schedule.

## Export your actual portfolio

1. Search a property and open its dossier.
2. Save a property that has matched HPD buildings.
3. Click **Export n8n monitor**. Properties without matched HPD IDs are excluded; the export rejects more than 25 IDs.
4. Import the JSON into your n8n instance.
5. Review **Portfolio configuration** and test the HTTP request. No API key is required for the anonymous NYC endpoint, subject to its availability and rate limits.
6. Publish the workflow only when you want its schedule active: daily at 7 AM, America/New_York.

## What it does

Schedule or manual trigger → actual portfolio IDs → NYC HTTP request → snapshot comparison → changes-only output.

First published run establishes a baseline and does not invent historical alerts. Later successful runs detect newly observed open records, status updates, and records no longer returned as open. Removed records require verification with HPD; their disappearance does not prove a completed repair.

HTTP failures, malformed responses, duplicate IDs, and more than 1,000 open records fail the run without accepting a new baseline. The schedule should have one concurrent execution; overlapping state writes are not supported.

The HTTP node includes status and body. The comparator requires HTTP 200 and an array body, so a malformed object cannot be mistaken for an empty list of violations.

The workflow only monitors matched HPD building IDs. It does not monitor PLUTO revisions, ACRIS transactions, DOB records, MLS listings, property prices or new ownership associations.

## State and testing

This small-portfolio prototype uses `$getWorkflowStaticData('global')`. n8n documents this as experimental. State persists only after successful published executions called by a trigger/webhook; manual test executions do not persist it. Consequently, manual tests cannot verify cross-execution persistence. Source and comparator code are tested in this repository, but import, scheduling and persistence have not been tested on a real n8n instance.

For a production service, replace static workflow state with a data table or database, use transactional updates and concurrency control, and add tenant isolation and execution-error monitoring. Do not market this export as a production multi-tenant notification service.

## Notifications

No messages are sent by the exported workflow. Add your chosen email/Slack/CRM node after **Changes only — attach your notification here**, configure its credentials and recipient, and test against your own inbox first. The JSON report contains dates, record IDs, classes, registered statuses and source links. Keep notification credentials in n8n credentials, not in the browser or GitHub repository.

## Official references

- Schedule and workflow publication: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/
- HTTP response options: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/
- Static-state restrictions: https://docs.n8n.io/build/code-in-n8n/cookbook/built-in-methods-and-variables-examples/getworkflowstaticdata.md
- Data tables: https://docs.n8n.io/build/work-with-data/data-tables/
