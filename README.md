# BlockSignal

An English-language research prototype for NYC maintenance and service businesses. It combines public HPD violation searches and registered owner/agent lookups with a saved, annotated building shortlist.

## Concrete use case

A pest control business selects its service ZIP code, reviews open records mentioning pests, checks the registered managing agent, and saves relevant buildings with notes. It exports a CSV containing the records, contact information loaded from HPD, qualification status, notes, and source links.

The intended benefit is less time navigating separate public datasets and organizing the findings. Whether that benefit is worth paying for has not been validated. Public data is free; the value of a commercial research service would come from verification and qualification.

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
```

Live verification requires internet access and checks the production query shape, service filters, and owner/agent dataset. If a Windows TLS inspection product uses the Windows trust store, `NODE_USE_SYSTEM_CA=1` may be needed. Certificate verification must remain enabled.

## What works

- Borough, ZIP code, and service filters on real HPD records.
- Up to 100 buildings ordered by matching open record count.
- Matching violation descriptions and registered contacts.
- Browser-local shortlist, qualification status, and notes.
- CSV exports for search results and saved research.
- Fictional demo explicitly separated from real research.

## Practical limits

- A violation is a research signal, not buying intent or a guaranteed sales lead.
- Keyword matching can include unrelated records and miss relevant ones. Read the descriptions.
- Records must be marked open and approved within the past 12 months. Older open violations are excluded.
- Counts reflect the search filters. Detail views show up to five matching records and up to 30 registered contacts.
- Registered names and mailing addresses may be outdated. No verified phone numbers or email addresses are provided.
- Shortlists persist only in the same browser and origin. Clearing site data removes them; export backups.
- API availability and anonymous request limits can interrupt searches.
- No payments, lead delivery service, automated outreach, team sync, or customer acquisition are implemented.

## Source and sample

- HPD Open Data: https://www.nyc.gov/site/hpd/about/open-data.page
- Violations: https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Violations/wvxf-dwi5
- Registration contacts: https://data.cityofnewyork.us/Housing-Development/Registration-Contacts/feu5-w2e2
- `samples/brooklyn-2026-10-09-unverified.csv`: 25 real Brooklyn buildings downloaded on October 9, 2026. This is an unqualified snapshot, not a live or customer-ready lead list.
- `docs/pilot-offer-template.txt`: the initial research-service proposal. Its $149 price is an unvalidated historical hypothesis, not product pricing.

## Next business validation

Pick one trade and service area. Verify five buildings manually, show the research to local businesses, and ask whether it improves their existing process. Confirm willingness to pay before implementing subscriptions, payments, or automated delivery.
