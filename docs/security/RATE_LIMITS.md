# Rate limits (S-E)

Migration 073 is in the repo and is not applied. Apply it on `ldtmhafewfifdizgfrnn` only after merge and Chris's OK. Until then `rate_limit_hit` is missing, and every wired route below fails closed (503 `unavailable`) except where a route has no check yet.

The counter is `public.rate_limit_hit` in `lib/security/rate-limit.ts`. An allowed request inserts one row. A denied request does not, so a quiet window clears the bucket. Rows older than 2 days are deleted inside the function. The response over the limit is 429 with `Retry-After` (the full window, in seconds) and `{ error: "Too many requests. Try again later." }`. The message does not say which bucket fired, and code-send does not say whether the email exists.

Keys:

- Email: SHA-256 hex of the trimmed, lowercased address.
- User: the session user id.
- IP: the first hop of `x-forwarded-for`, otherwise `x-real-ip`, otherwise `unknown`.

If the function errors, code send, verify, magic, outreach send, and uploads fail closed (503). `enforceRules({ failureMode: "open" })` lets the request through. No read route uses that mode in this job.

| Route | Limit | Key | On limiter failure |
| --- | --- | --- | --- |
| `POST /api/auth/login/otp` | 3 per 15 minutes | email hash | closed |
| `POST /api/auth/login/otp` | 10 per hour | IP | closed |
| `POST /api/auth/login/otp/verify` | 5 per 15 minutes | email hash | closed |
| `GET /api/auth/magic` | 10 per hour | IP | closed |
| `POST /api/campaigns/outreach/send` | 20 per hour and 100 per day | user id | closed |
| `POST /api/outreach` | 20 per hour and 100 per day | user id | closed |
| `POST /api/deals/import` | 20 per hour | IP (`ip:` prefix) | closed |
| `POST /api/shows/import` | 20 per hour | user id | closed |
| `POST /api/show-profile/media-kit` | 20 per hour | user id | closed |
| `POST /api/reps/roster/import` | 10 per hour | user id | closed |

`POST /api/reps/roster/import` calls `enforceRosterImport` after `requireAgent` and before the body is read. The route still caps the upload at 500 data rows and 1 MB (1,048,576 bytes). An oversized `Content-Length` is 413 before the body is read. A missing or low `Content-Length` is capped by the running byte count.

`POST /api/deals/import` is keyed by IP. The IO PDF branch does not call `getAuthenticatedUser`, and this job does not add that lookup. The past-campaign branch on the same handler shares the IP bucket. Its 10 MB and file-type checks are unchanged.

`POST /api/shows/import` still has no byte or row cap (SA-14). `POST /api/show-profile/media-kit` still caps the upload at 2 MB compressed and slices the text at 20,000 characters. Those caps are unchanged.

Verify counts each request that already has a valid email and a 6-digit code. Five of those in 15 minutes lock the email until the oldest falls out of the window. The existing `login_otp_consume` lock is unchanged and still runs when this window allows the request.

Login code send runs this check after the outreach-token gate and before the profile lookup, so a known address and an unknown address get the same 429. The existing per-minute and per-hour `login_otp_consume` rules still run after this check allows the request.

## Not wired

These S-A items stay open. Their files are outside this job.

- `POST /api/auth/magic/start` (SA-09) can still email a login link with no limit.
- `POST /api/campaigns/outreach/generate` (SA-08) is unchanged.
- Pitch accept, counter, and decline still use the in-process limiter (SA-11).
- Discovery, interpret, and enrich routes still have no shared limit (SA-15).
