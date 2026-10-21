# Senior dev handoff

## I2: Past-campaign parse API

### What was built

`POST /api/deals/import` accepts `mode=past_campaign` (form field or query) and returns drafts only. The branch requires a signed-in brand or agency, same as the save route. CSV and XLSX go through `callLLMWithFallback` and `lib/prompts/past-campaign-mapping.md` to map columns. Past-campaign PDFs call `createLLMClient()` from `lib/llm/client.ts` and pass model `claude-sonnet-4-20250514` explicitly, then `dealsFromImportedIO`. That model matches the older IO PDF path. The older path still constructs its own client and is unchanged.

`POST /api/imports/past-campaigns` saves one `past_campaign_imports` row and its `past_campaign_records` for the signed-in brand or agency. `brand_id` is the session user on both rows (composite FK). A `brand_id` in the body is ignored. `matched_show_id` is an exact case-insensitive show-name hint: one match is stored, zero or several stay empty. The hint is not a write to `shows`.

Limits on parse: 10MB, 2,000 data rows, extension plus MIME. An XLSX is rejected before exceljs loads it when the inflated zip entries exceed 32MB (`lib/imports/xlsx-limit.ts`), including a stream that under-reports its size in the zip header. Save status is `confirmed`. `pooling_consent` defaults to false, and `terms_version` is stored only when consent is true.

### Where

- `lib/imports/csv.ts`
- `lib/imports/xlsx-limit.ts`
- `lib/imports/past-campaigns.ts`
- `lib/imports/fixtures/past-campaign.csv`
- `lib/imports/fixtures/past-campaign.pdf`
- `lib/prompts/past-campaign-mapping.md`
- `app/api/deals/import/route.ts` (new branch only)
- `app/api/imports/past-campaigns/route.ts`
- `package.json` / `package-lock.json` (`exceljs@4.4.0`, regenerated from the main lockfile). Existing locked package versions are unchanged. Where an exceljs dependency needs a newer copy, that copy is nested under the new package.

### Tests

`npx vitest run lib/imports app/api/deals/import app/api/imports`

Covers CSV, XLSX (first sheet only), and PDF fixtures with a mocked LLM, the old IO response shape, body `brand_id` ignored, and both 054 tables written under the session brand. Supabase is mocked. No live writes.

### Known gaps

- Migration 054 is in the repo and is not applied. Save will fail against the live database until Chris applies it after merge.
- No UI in this job. The older IO PDF and manual JSON paths stay open without a session. `mode=past_campaign` and the save route require a brand or agency session.
- XLSX reads the first worksheet only. A sheet whose dimension is more than 7,000 rows is rejected.
- PDF drafts follow `dealsFromImportedIO`: one row per show, price and downloads taken from the first line item. Conversions are empty because an IO does not carry them.
- `matched_show_id` is a hint. A failed or ambiguous name lookup leaves it empty and still saves the row.
- `exceljs` is imported directly. `next.config.ts` was not changed.
- CSV MIME must be `text/csv`, `application/csv`, `text/plain`, or `application/vnd.ms-excel`. XLSX must be the Open XML sheet MIME. `application/octet-stream` is rejected.
