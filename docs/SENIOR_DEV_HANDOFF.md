## M0

### What was built

An admin-only clickable mockup of the pending screens, so they can be signed off before any of those UI jobs start. Every page checks `isInternalAdmin` on the server and calls `notFound()` otherwise. Data comes from static fixtures. Buttons update React state in the browser only. Every page shows the banner "Mockup. Nothing here is saved."

Surfaces:

- CRM index, with a Free upgrade card. Starter and Operator previews open the show list. `canUseCrm` is mirrored locally as `previewCanUseCrm` (Starter, Operator, and the legacy agency id).
- Per-show CRM: Contacts (add, edit, remove), Notes (add, remove), and read-only Deal history with placement, episodes, CPM, total, and flight.
- Past campaign import: choose CSV, XLSX, or PDF, name a file, edit sample rows, see an advisory catalog suggestion, accept or skip pooling consent (`pooling-v1`), then a confirmed summary. Discard is local too.
- Rep roster: Exclusive starts on and can be turned off. Rep deals for roster links show status and flight only. Per-show view repeats that, plus the exclusive switch. Roster CSV upload parses show names in the browser, previews them as pending with Exclusive on, and can be confirmed locally.
- Roster requests: pending, approved, and rejected, with approve and reject.
- API keys: create with scopes, show the secret once, hide it, revoke, and show last used.
- Approvals: pending actions with approve and reject.

### Where

- `app/(dashboard)/admin/mockups/page.tsx` at `/admin/mockups`
- `app/(dashboard)/admin/mockups/crm/page.tsx` at `/admin/mockups/crm`
- `app/(dashboard)/admin/mockups/crm/[showId]/page.tsx` at `/admin/mockups/crm/[showId]`
- `app/(dashboard)/admin/mockups/import/page.tsx` at `/admin/mockups/import`
- `app/(dashboard)/admin/mockups/rep/page.tsx` at `/admin/mockups/rep`
- `app/(dashboard)/admin/mockups/rep/deals/page.tsx` at `/admin/mockups/rep/deals`
- `app/(dashboard)/admin/mockups/rep/shows/[showId]/page.tsx` at `/admin/mockups/rep/shows/[showId]`
- `app/(dashboard)/admin/mockups/rep/upload/page.tsx` at `/admin/mockups/rep/upload`
- `app/(dashboard)/admin/mockups/roster-requests/page.tsx` at `/admin/mockups/roster-requests`
- `app/(dashboard)/admin/mockups/api-keys/page.tsx` at `/admin/mockups/api-keys`
- `app/(dashboard)/admin/mockups/approvals/page.tsx` at `/admin/mockups/approvals`
- Fixtures and the admin gate: `app/(dashboard)/admin/mockups/fixtures.ts`, `app/(dashboard)/admin/mockups/require-admin.ts`
- Shared Ink & Gold chrome: `app/(dashboard)/admin/mockups/chrome.tsx`

The index is not in the sidebar. `lib/nav/items.ts` was left alone. Open `/admin/mockups` while signed in as an internal admin.

### Tests

`npx vitest run "app/(dashboard)/admin/mockups"` (26 tests).

- `require-admin.test.ts`: signed-out and non-admin sessions 404; an allowlisted email passes. The helper is the real `isInternalAdmin`.
- `mockups.test.tsx`: each route renders the banner, an unknown show id 404s after the admin check, rendered text has no em dash, and the click paths stay local (upgrade card, contact and note, import through consent, exclusive toggle, CSV preview, roster approve/reject, API key shown once then hidden, approval approve/reject). Rep deals render no dollar amounts.

### Known gaps

- Nothing is saved. There is no database read or write, no server action, and no request from these pages. A refresh restores the fixtures.
- The import review always loads sample rows, including after a real file is chosen, so CSV, XLSX, and PDF can be clicked through without a parser. The roster CSV screen does read a chosen text file in the browser.
- The Free upgrade button only switches this preview to Starter. It does not bill.
- The client does not import `lib/entitlements/plan.ts`, because that module opens a server client. `previewCanUseCrm` matches `canUseCrm`.
- Rep deal fixtures have no amount fields, so that screen cannot show CPM, rate, or spend.
- Sidebar entry, real persistence, file parsing for XLSX and PDF, and wiring approve/reject to roster status are later jobs. Migrations 053, 054, and 055 are not applied here. The fixtures follow their column shapes only.
