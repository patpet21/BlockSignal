# BlockSignal product decision

Research date: October 9, 2026. Evidence, judgments and unvalidated commercial assumptions are separated below.

## Decision

Offer a customer-specific enquiry follow-up installation service for small residential agencies, multifamily broker teams and property management firms. Begin with one inbound source and one accountable handoff. Use a request audit to establish whether the customer's existing records show gaps before quoting an installation.

The initial buyer is a business that already receives commercial enquiries and has inconsistent ownership, first-response history or next actions. For management firms, this means owners asking about management services. Resident maintenance requests and tenant screening are outside this pilot.

The purchased outcome is a configured, monitored process: the correct request reaches a responsible person, its next action is recorded, and exceptions appear in an internal report. Implementation and maintenance are the offering. It is not necessary to claim that another generic CRM has been invented.

## Evidence and alternatives

| Candidate | Verified existing supply | Judgment |
| --- | --- | --- |
| Public property research | PropertyShark publishes ownership, deeds, liens and violation features. | Our current map/dossier has insufficient differentiation to lead the paid offer. |
| General maintenance automation | AppFolio advertises intake, follow-up, vendor coordination and work orders; Property Meld lists maintenance operations at $2/unit/month with a $200/month minimum. | An entire maintenance platform is a poor initial scope for this repository. The published price demonstrates a paid category, not demand for our service. |
| Invoice matching | Vic.ai documents PO matching, exceptions and approval workflows. | A basic duplicate-invoice checker would face sophisticated existing products and depend on reliable private financial data. |
| Enquiry handoff implementation | Follow Up Boss lists lead distribution, automated action plans, email/calendar sync and a $69/user monthly Grow plan. | The candidate is configuration across the customer's actual sources and workflow, supported by a focused audit. Sell it only when existing configuration fails their agreed process. |

An individual real-estate discussion describes leads arriving while agents inconsistently initiate searches and follow-up, even with Follow Up Boss in place. This is one self-reported example of an implementation gap. Its account, volumes and conversion assertions have not been independently verified; it is not representative market research or proof of willingness to pay.

Sources retrieved October 9, 2026:

- Property research features: https://www.propertyshark.com/property-data/ownership-and-legal
- Maintenance capabilities: https://www.appfolio.com/property-manager/maintenance
- Maintenance pricing: https://propertymeld.com/pricing/
- PO matching: https://help.vic.ai/en/articles/8148444-po-matching-overview
- Follow Up Boss features and pricing: https://www.followupboss.com/pricing
- Individual workflow account: https://www.reddit.com/r/RealEstateTechnology/comments/1whm08n/i_have_a_big_problem_i_need_to_solve_i_have_leads/

## Why this is a commercial hypothesis

Competitor pricing establishes that software is offered for these workflows. It does not establish that a customer will buy BlockSignal, accept our proposed price or gain additional appointments. The narrower service is selected because it can be scoped and measured using a customer's own workflow before committing to a large platform build.

Suitable prospect: a small team with existing enquiry volume, access to its own email/CRM history, an available responsible person and an observable handoff problem. Unsuitable prospect: no inbound enquiries, a well-functioning existing automation, unavailable activity history, or a requirement for unlicensed MLS data or automated tenant eligibility decisions.

## What now works in the repository

The request audit runs in a browser using actual supplied CSV records. It checks missing owners, unrecorded responses beyond a configurable target, overdue next steps, and appointment dates/outcomes. It distinguishes a missing timestamp from proof of an ignored lead. Closed and opted-out records do not create follow-up recommendations.

The user can review a record, update a working copy, prepare a draft and export the copy and action report. These edits do not change a customer's CRM or send messages. There is no sample customer population, estimated revenue, fabricated success rate, fake integrations or autonomous qualification score.

The n8n export is an inactive authenticated snapshot-audit component. Live ingestion, durable state, external task creation, delivery and calendar connections require authorised customer-specific configuration. The user deferred n8n deployment; no instance has been connected.

The earlier NYC map and dossier remain available as a secondary research tool.

## Measurement and acceptance

For an authorised pilot, collect a baseline from actual activity records: enquiries received, assigned ownership, first response times where recorded, next-step completion and appointment outcomes. Establish the definition of a response with the customer; a missing export field is not evidence of neglect.

Agree the response target and business hours with the customer. The current audit uses elapsed clock hours; business-hour routing and a customer's timezone/holiday schedule must be configured for their live workflow.

Installation acceptance: the customer traces a test enquiry from its real source to the agreed owner, verifies that a recorded response suppresses an unnecessary follow-up, checks an unassigned/overdue exception, confirms duplicate handling and suppression for closed/opted-out records, and verifies execution-error alerts and credentials. Use consented test records in their own systems; do not contact real prospects without authorisation.

Commercial validation gate: obtain two paid, bounded pilots and a renewal decision before building a multi-tenant SaaS. This is a proposed decision rule, not a result already achieved. If candidates are satisfied by configuring their existing CRM, offer that configuration service or reject unnecessary custom development.

Proposed pilot pricing and exact scope: [follow-up-pilot.md](follow-up-pilot.md).
