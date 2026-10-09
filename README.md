# BlockSignal

An English-language NYC property workspace for property managers, multifamily brokers, and residential agents. It connects a real interactive map, PLUTO tax-lot facts, HPD registrations and open records, and ACRIS documents with property dossiers, saved actions and snapshot comparisons.

## Concrete use case

A property manager saves managed buildings, records a responsible person and next action, and checks for changes in open HPD records. A multifamily broker searches tax lots by location, address and unit count, then reviews ownership fields and recorded documents. A residential agent prepares a dated, printable dossier for a client or appointment. Residential mode does not provide listings, seller intent or an MLS feed.

The intended benefit is less time navigating separate public sources and better follow-through on the findings. Whether customers will pay for this workflow has not been validated. This is a functioning prototype, not a complete property-management system or brokerage CRM. There is no quantum-computing claim or invented prediction score.

## Deploy on Netlify

1. Import `patpet21/BlockSignal` from GitHub.
2. Select the `main` branch.
3. Leave the base directory and build command empty. Publish directory: `dist`.
4. Deploy. The root `netlify.toml` already specifies the publish directory.

No build, API key, ChatGPT account, environment variable, backend, or paid service is required by the application. Netlify account/hosting terms are separate. The GitHub version is independent of the earlier Sites-hosted prototype.

Official configuration reference: https://docs.netlify.com/build/configure-builds/file-based-configuration/

## Run locally

With Node.js 22 or later:

```sh
npm run dev
```

Open http://127.0.0.1:4173. No dependency installation is necessary. ES modules require an HTTP server; do not open index.html directly as a file.

```sh
npm test
npm run verify:live
npm run verify:urban
```

Live verification requires internet access. The urban check validates a real HPD → PLUTO join, official coordinates, a multifamily search, contacts, open records and ACRIS documents. If a Windows TLS inspection product uses the Windows trust store, `NODE_USE_SYSTEM_CA=1` may be needed. Certificate verification must remain enabled.

## What works

- Three modes with different default searches and workflow guidance.
- Leaflet map with real PLUTO tax-lot coordinates, including coverage/missing-coordinate counts.
- Borough/ZIP/topic HPD searches and borough/ZIP/address/unit-count property searches.
- Dossiers with lot characteristics, registered contacts, all-date open HPD snapshots, recorded ACRIS documents and source links.
- Browser-local saved properties, workflow stage, responsible person, next action date, reference and notes.
- Complete-snapshot comparisons: new records, status updates and records no longer returned as open.
- CSV exports and print-ready HTML dossiers (open in a browser to print/save PDF).
- n8n monitor export containing your saved HPD IDs. No fake demonstration records in the new interface.

## Practical limits

- A violation is a research signal, not buying intent or a guaranteed sales lead.
- Keyword matching can include unrelated records and miss relevant ones. Read the descriptions.
- HPD map searches include open records approved in the past 12 months; older open records are excluded from that search. Dossiers and monitoring query all dates for matched HPD buildings.
- Property searches return at most 100 residential tax lots, ordered by address. They are not an exhaustive inventory.
- PLUTO values and coordinates are tax-lot values, which can cover multiple buildings. Missing coordinates are not guessed.
- Dossiers match active HPD building registrations by borough/block/lot. HPD is not universal coverage, and no match does not establish a clean record.
- Complete snapshots are capped at 1,000 open records per property; overflow fails and retains the baseline. The dossier displays the first 50 descriptions. Up to 200 registered contacts are queried.
- ACRIS lookup uses up to 20 document IDs for the current lot, then sorts their master records by recorded date. It does not expand historic lot changes. Staten Island uses separate property records. Document amounts are not automatically sales prices or valuations.
- Registered names and mailing addresses may be outdated. No verified phone numbers or email addresses are provided.
- Shortlists persist only in the same browser and origin. Clearing site data removes them; export backups.
- API availability and anonymous request limits can interrupt searches.
- No payments, MLS access, verified phone/email enrichment, automated outreach, team sync, or customer acquisition are implemented.
- First successful monitor check establishes a baseline. A record disappearing from the open query is marked for verification, not described as a completed repair. Source failures leave the previous baseline intact.
- Browser comparison checks up to 25 saved properties per run. It works while the page is open; scheduled monitoring requires a separately deployed n8n workflow.

## Source and sample

- HPD Open Data: https://www.nyc.gov/site/hpd/about/open-data.page
- Violations: https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Violations/wvxf-dwi5
- Registration contacts: https://data.cityofnewyork.us/Housing-Development/Registration-Contacts/feu5-w2e2
- HPD buildings: https://data.cityofnewyork.us/Housing-Development/Buildings/kj4p-ruqc
- PLUTO: https://data.cityofnewyork.us/City-Government/Primary-Land-Use-Tax-Lot-Output-PLUTO/64uk-42ks
- ACRIS: https://www.nyc.gov/site/finance/property/acris.page
- Map basemap: OpenStreetMap, with visible attribution. No tile prefetch or offline map export. For a paid product at scale, configure a suitable hosted tile provider rather than relying on community best-effort tiles: https://operations.osmfoundation.org/policies/tiles/
- `samples/brooklyn-2026-10-09-unverified.csv`: 25 real Brooklyn buildings downloaded on October 9, 2026. This is an unqualified snapshot, not a live or customer-ready lead list.
- `docs/pilot-offer-template.txt`: the initial research-service proposal. Its $149 price is an unvalidated historical hypothesis, not product pricing.

## Next business validation

Test each mode against the customer's existing workflow: time to prepare a dossier, time to notice a record change, and actions that were actually completed. Compare with tools such as HPD Online and PropertyShark. Confirm willingness to pay before subscriptions or verified-contact enrichment. More map layers alone do not establish a competitive advantage.

## n8n integration

Save a property after loading its dossier, then click **Export n8n monitor**. This exports actual saved HPD building IDs, not a generic fake portfolio. Import the JSON into n8n, review it, test the NYC request, and publish when you want to enable the daily 7 AM `America/New_York` schedule. No instance was connected and no schedule activated in this repository setup.

The workflow is inactive on export, supports up to 25 HPD building IDs / 1,000 open records, establishes a first-run baseline, and emits changes only. It has no recipients or notification credentials. See [docs/n8n-setup.md](docs/n8n-setup.md) before publishing. Its static state is an experimental small-portfolio prototype; durable storage and concurrency control are required for production teams.

[docs/example-portfolio-monitor.json](docs/example-portfolio-monitor.json) is a downloadable inactive example for one real public building, not a customer portfolio. The same export is generated from your own saved properties in the application.

Previous browser-local v1 shortlists are read and migrated when the new workspace is first opened on the same origin. The original v1 storage key is retained.
