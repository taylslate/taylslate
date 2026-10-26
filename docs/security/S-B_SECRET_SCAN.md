# S-B Secret scan

Scan date: 26 October 2026.

Repository: `taylslate/taylslate` (public).

HEAD: `ba841442d847b3661dbe6b3747628b4cf656d8c4`.

Scope: the working tree, every commit reachable from this clone (`git rev-list --all` is 426 commits across 35 refs), and every blob those commits reach (2655 blobs, 34,661,340 bytes). No tags. No stash. The working tree had no `.env.local`, no `.pem`, and no untracked key file. `.env.example` is the only env file on disk.

## Result

Zero credential-shaped values. That covers live Stripe secret keys, test Stripe secret keys, restricted keys, webhook secrets with a real body, three-segment JWTs (including a Supabase `service_role` key), PEM private keys, and long `api_key` assignments. Gitleaks 8.30.1 reported no leaks on the history walk and on the working tree.

The rotation list is empty. This job did not rotate a key, rewrite history, or change a GitHub, Vercel, Stripe, Supabase, or DocuSign setting.

## Commands and tool version

Gitleaks 8.30.1 (`gitleaks version` prints `8.30.1`).

History, from the repo root:

```
gitleaks detect --source . --log-opts="--all --full-history" --redact --no-banner --report-format json --report-path /tmp/gitleaks-s-b-history.json --exit-code 0
```

Result on this run: 401 commits scanned, about 10.33 MB, `no leaks found`. The JSON report had 0 findings. The raw report was deleted after the count was taken. `--redact` was on, so the log did not print a secret.

Working tree, including files that are not a commit:

```
gitleaks detect --no-git --source . --redact --no-banner --report-format json --report-path /tmp/gitleaks-s-b-tree.json --exit-code 0
```

Result on a clean checkout, before `npm ci`: about 6.70 MB, `no leaks found`, 0 findings. That is the source tree.

`--no-git` also walks gitignored directories if they are on disk. After `npm ci` and `npx next build` the same command scanned about 91 MB and reported 17 hits, all under `.next`. They are local build values Next writes for preview mode and for its cache (`previewModeSigningKey`, `previewModeEncryptionKey`, and the cache encryption key), plus generic-api-key hits on that build output. `node_modules` added no hits. None of the 17 paths are tracked. `.next` is gitignored. Those values are not in the 426 commits.

`git rev-list --all --count` is 426. Twenty-two of those commits are merges. Gitleaks reports 401 commits for the same `--all --full-history` walk. The blob walk below is what covers every object the 426 commits can reach.

Required patterns, over every reachable blob and over `git log --all --pretty=%B` (commit messages, 194,434 bytes):

- `sk_live_`
- `sk_test_`
- `rk_`
- `whsec_`
- `eyJ`
- `service_role`
- `SUPABASE_SERVICE_ROLE`
- `DOCUSIGN`
- `BEGIN` followed by `PRIVATE KEY`
- `api_key` with optional whitespace and then `=`

A hit is credential-shaped when a Stripe prefix has 8 or more trailing letters or digits, a `whsec_` value has 12 or more, a JWT has three segments, a PEM header reads `BEGIN ... PRIVATE KEY`, or a quoted assignment value is a long token. The rows below are the other hits: placeholders, prefixes in prose, test fixtures, and substrings.

## Credential-shaped hits

Zero. Nothing in this table is a live key or a test vendor key.

## Pattern hits

Commit is the commit that last touched the line (`git blame`) when the line is in HEAD. For a line that is gone, the commit is the one that introduced the text. Prefix is the first 4 characters of the matched text. Mode `neither` means the match is not a live key and not a test vendor key.

| File | Line | Commit | Type | Prefix | Mode | In HEAD |
| --- | --- | --- | --- | --- | --- | --- |
| `PILE_A_PROOF.md` | 131 | `772863446511db14714487fb680056977c3efbf2` | `sk_live_` placeholder, length 10 | `sk_l` | neither | yes |
| `PILE_A_PROOF.md` | 131 | `772863446511db14714487fb680056977c3efbf2` | `sk_test_` placeholder, length 10 | `sk_t` | neither | yes |
| `PILE_A_PROOF.md` | 132 | `772863446511db14714487fb680056977c3efbf2` | `pk_live_` placeholder, length 10 | `pk_l` | neither | yes |
| `PILE_A_PROOF.md` | 132 | `772863446511db14714487fb680056977c3efbf2` | `pk_test_` placeholder, length 10 | `pk_t` | neither | yes |
| `PILE_A_PROOF.md` | 133 | `772863446511db14714487fb680056977c3efbf2` | `whsec_` placeholder, length 8 | `whse` | neither | yes |
| `app/api/stripe/payment-method/setup-intent/route.ts` | 87 | `ad626ccf6054656e2bea700d6fb0d7182917e15f` | `sk_live_` prefix only, length 8 | `sk_l` | neither | yes |
| `app/api/stripe/payment-method/setup-intent/route.ts` | 87 | `ad626ccf6054656e2bea700d6fb0d7182917e15f` | `sk_test_` prefix only, length 8 | `sk_t` | neither | yes |
| `app/api/stripe/payment-method/setup-intent/route.ts` | 87 | `ad626ccf6054656e2bea700d6fb0d7182917e15f` | `pk_live_` prefix only | `pk_l` | neither | yes |
| `app/api/stripe/payment-method/setup-intent/route.ts` | 87 | `ad626ccf6054656e2bea700d6fb0d7182917e15f` | `pk_test_` prefix only | `pk_t` | neither | yes |
| `scripts/setup-stripe-products.ts` | 11 | `4b3d4e3f81e6fbbd5685e6c8c1868a7fec3a698f` | `sk_test_` placeholder, length 11 | `sk_t` | neither | yes |
| `components/deals/Wave12DealClient.test.tsx` | 103 | `772863446511db14714487fb680056977c3efbf2` | publishable test fixture, length 9 | `pk_t` | neither | yes |
| `AGENTS.md` | 198 | `8e2565860bf895ef93db4134bac62eab238500f4` | `whsec_` placeholder, length 9 | `whse` | neither | yes |
| `docs/WAVE_HISTORY.md` | 164 | `a9a6ac018f3eca8484de672cb3672ee19f20f9d7` | `whsec_` placeholder, length 9 | `whse` | neither | yes |
| `TECHNICAL_SPEC.md` | 993 | `7fb079a3d08bd0b6730abcc7c4c6431cb867cd58` | `whsec_` placeholder, length 9 | `whse` | neither | yes |
| `CLAUDE.md` (historical) |  | `855f5191ca76a6b8ed40755396b1ec1824df5fe0` | same `whsec_` placeholder, removed later in `4f6d1f30d56db9107bd32aa847c6c72b968e44bc` | `whse` | neither | no |
| `lib/stripe/webhook.test.ts` | 79 | `6c28b762389b73aad6b7ef9a6a20337cfe8f9f41` | webhook test fixture, value length 10 | `whse` | neither | yes |
| `lib/stripe/webhook.test.ts` | 127 | `6c28b762389b73aad6b7ef9a6a20337cfe8f9f41` | same webhook test fixture, value length 10 | `whse` | neither | yes |
| `TECHNICAL_SPEC.md` | 978 | `7fb079a3d08bd0b6730abcc7c4c6431cb867cd58` | `eyJ` placeholder, length 6 | `eyJ.` | neither | yes |
| `TECHNICAL_SPEC.md` | 979 | `4a4c6ce530c20739ec50062d886cca2a139b3901` | `eyJ` placeholder, length 6, on the service role example line | `eyJ.` | neither | yes |
| `package-lock.json` | 9680 | `7a12df8340968660af42344c85c251c9c4c50b4e` | `eyJ` inside an npm `sha512` integrity string, not a JWT | `eyJI` | neither | yes |
| `TECHNICAL_SPEC.md` | 979 | `4a4c6ce530c20739ec50062d886cca2a139b3901` | `SUPABASE_SERVICE_ROLE` placeholder assignment | `SUPA` | neither | yes |
| `lib/supabase/admin.test.ts` | 64 | `e7f8b0f24c8cf88809ace2d85bdc2059fc60e706` | service role test fixture, value length 21, letters and hyphens | `serv` | neither | yes |
| `AGENTS.md` | 130 | `8e2565860bf895ef93db4134bac62eab238500f4` | `RESEND_API_KEY=` placeholder, length 14 | `API_` | neither | yes |
| `docs/WAVE_HISTORY.md` | 96 | `a9a6ac018f3eca8484de672cb3672ee19f20f9d7` | same `RESEND_API_KEY=` placeholder | `API_` | neither | yes |
| `TECHNICAL_SPEC.md` | 982 | `7fb079a3d08bd0b6730abcc7c4c6431cb867cd58` | `ANTHROPIC_API_KEY=` placeholder, length 18 | `API_` | neither | yes |
| `TECHNICAL_SPEC.md` | 985 | `4a4c6ce530c20739ec50062d886cca2a139b3901` | `RESEND_API_KEY=` placeholder, length 14 | `API_` | neither | yes |
| `TECHNICAL_SPEC.md` | 988 | `4a4c6ce530c20739ec50062d886cca2a139b3901` | `REPHONIC_API_KEY=` placeholder, length 11 | `API_` | neither | yes |
| `TECHNICAL_SPEC.md` | 989 | `4a4c6ce530c20739ec50062d886cca2a139b3901` | `PODSCAN_API_KEY=` placeholder, length 11 | `API_` | neither | yes |
| `CLAUDE.md` (historical) |  | `855f5191ca76a6b8ed40755396b1ec1824df5fe0` | same `RESEND_API_KEY=` placeholder as `AGENTS.md` | `API_` | neither | no |
| `app/api/campaigns/outreach/send/route.test.ts` | 38 | `7c533648723a92d48aca5c5ba40eee33b5ce4fc6` | `RESEND_API_KEY` test fixture, value length 7 | `re_t` | neither | yes |
| `app/api/invoices/send/route.test.ts` | 90 | `7c533648723a92d48aca5c5ba40eee33b5ce4fc6` | same Resend test fixture, value length 7 | `re_t` | neither | yes |
| `app/api/deals/[id]/io/send/route.test.ts` | 104 | `2400b77673df14367d9e4e8e2a34b686d0f0f3ce` | same Resend test fixture, value length 7 | `re_t` | neither | yes |
| `lib/email/send.test.ts` | 49 | `2400b77673df14367d9e4e8e2a34b686d0f0f3ce` | same Resend test fixture, value length 7 | `re_t` | neither | yes |
| `app/api/campaigns/score/route.test.ts` (deleted) |  | `07c89b8ca93f5963119778200f1e2422f77232f4` | `ANTHROPIC_API_KEY` test fixture, value length 8. File removed in `d01346d06058317ca500c9c12cc9cda8f2839200` | `test` | neither | no |
| `lib/airchecks/transcribe.test.ts` | 173 | `c743e84accfeed476d7ecac493424cc545ab3342` | `PODSCAN_API_KEY` test fixture, value length 8 | `test` | neither | yes |
| `lib/airchecks/transcribe.test.ts` | 269 | `c743e84accfeed476d7ecac493424cc545ab3342` | airchecks key test fixture, value length 12 | `test` | neither | yes |

`rk_live_` and `rk_test_` occur zero times. Every `rk_` hit is the letters `rk_` inside the identifier `network_rep`, or, in one historical line, inside `network_download`.

| File | Line | Commit | Type | Prefix | Mode | In HEAD |
| --- | --- | --- | --- | --- | --- | --- |
| `supabase/migrations/001_initial_schema.sql` | 36 | `ab6a92c739b9e7744c0666b50c85f3a54b63f6fc` | substring of `network_rep` | `rk_r` | neither | yes |
| `supabase/migrations/000_drop_and_recreate.sql` | 69 | `e8e74be743c4eafab325027e09bb4cae967ee822` | substring of `network_rep` | `rk_r` | neither | yes |
| `lib/data/types.ts` | 44 | `f6d4547de3a5b1c73c312e5e96d3949a55714f65` | substring of `network_rep` | `rk_r` | neither | yes |
| `lib/data/seed.ts` | 104, 160, 188, 244, 331 | `f6d4547de3a5b1c73c312e5e96d3949a55714f65` | substring of `network_rep` | `rk_r` | neither | yes |
| `TECHNICAL_SPEC.md` | 160 | `4a4c6ce530c20739ec50062d886cca2a139b3901` | substring of `network_rep` | `rk_r` | neither | yes |
| `app/(dashboard)/shows/shows-client.tsx` | 339 | `5fe99ea954add7876cf04bbf6db2a768b603cbbf` | substring of `network_rep` | `rk_r` | neither | yes |
| `app/(dashboard)/shows/page.tsx` (historical text) |  | `777618f54dfb3a2623c03131a178ec173d7032e9` | substring of `network_rep`. Current file does not contain it | `rk_r` | neither | no |
| `app/api/shows/[id]/enrich/route.ts` (historical text) |  | `6cc67ed36ffb8369061899cd464d6b1de032365c` | substring of `network_download`. Current file does not contain it | `rk_d` | neither | no |

`BEGIN` followed by `PRIVATE KEY`: zero hits in every blob and every commit message. The only `BEGIN ` text is two SQL examples in historical `CLAUDE.md` (`DO $$ BEGIN`), introduced in `d4344ec880924e6ffe096cf0440f73cef5656ba1` and absent from HEAD.

## Identifier hits

These counts are the word or the env name, not a value. The blob walk found zero JWTs, so a `service_role` line cannot be a service role key.

HEAD (`rg -c` on the working tree):

| Pattern | Files | Matches | Where the matches sit |
| --- | --- | --- | --- |
| `service_role` | 79 | 400 | `supabase` 323, `docs` 60, `lib` 11, `AGENTS.md` 2, `STATUS.md` 2, `CLAUDE.md` 1, `app` 1 |
| `SUPABASE_SERVICE_ROLE` | 15 | 19 | `scripts` 11, `lib` 4, and one each in `STATUS.md`, `README.md`, `TECHNICAL_SPEC.md`, `docs` |
| `DOCUSIGN` | 12 | 50 | `scripts` 13, `lib` 9, `docs` 8, `AGENTS.md` 7, `app` 4, `PILE_A_PROOF.md` 4, `STATUS.md` 3, `PILE_A_INVENTORY.md` 2 |

Across every historical blob the same words sum higher, because each old version of a file is counted: `service_role` 1088 across 84 paths, `SUPABASE_SERVICE_ROLE` 33 across 15 paths, `DOCUSIGN` 285 across 13 paths. Commit messages add 10 `service_role` and 3 `DOCUSIGN`. They add zero of the key prefixes.

`DOCUSIGN_*` assignments across those blobs: 84 are a placeholder or a `process.env` read, 22 are shorter than 16 characters, 15 are the documented enum `sandbox|production` (prefix `sand`, length 19). Zero are a long token. DocuSign RSA private key material does not appear.

The two `SUPABASE_SERVICE_ROLE` assignments are the placeholder and the length-21 test fixture in the table above.

## `.gitignore` and `NEXT_PUBLIC_`

`.gitignore` ignores `.env*` and then un-ignores `.env.example`. It ignores `.vercel`. It ignores `*.pem`. `next-env.d.ts` is ignored and is generated TypeScript, not a key.

`git log --all --name-only` for `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, and `credentials.json` lists only `.env.example`. That file sets `MANAGED_ACCOUNT_INBOX=` to an empty value.

Gap, left unchanged because this job does not edit config: `.gitignore` does not name `*.key`, `*.p12`, `*.pfx`, or `id_rsa`. None of those names are in history.

`NEXT_PUBLIC_` names in the tree:

| Name | What was committed |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | A public origin. Test files set `https://www.taylslate.com/` or `http://localhost:3000`. |
| `NEXT_PUBLIC_SUPABASE_URL` | The public project URL name. Tests use `https://example.supabase.co`. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The public anon key name. The only committed shape is the `eyJ` placeholder in `TECHNICAL_SPEC.md`. No JWT. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | The public publishable key name. Committed text is the prefix or the dot placeholder in the table above. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | The public Turnstile site-key name. No value is committed. |

`next.config.ts` does not embed a key. It marks the DocuSign and Stripe packages external and traces their files into the server bundle. `vercel.json` sets region `pdx1` and three cron paths. No key.

## Keys to rotate

None. No committed value from this scan needs a rotation. Rotation was not done.

This scan did not read Vercel env, the Stripe dashboard, the Supabase dashboard, DocuSign, or Resend. A key that never entered git is outside this result.

## Turn on GitHub secret scanning and push protection

Do this in the GitHub UI. This job did not change the setting.

`taylslate/taylslate` is a public repository owned by the `taylslate` organization. Secret scanning alerts for users are free on public repositories. GitHub's 11 March 2024 changelog turned secret scanning and push protection on by default for new public repositories owned by personal accounts. Organization repositories, and repositories that already existed, stay on the admin's setting.

Clicks, from GitHub's docs for enabling secret scanning and enabling push protection:

1. Open the repository `taylslate/taylslate`.
2. Click Settings. If the tab is hidden, open the repository menu and click Settings.
3. In the sidebar, under Security and quality, click Advanced Security.
4. To the right of Secret Protection, click Enable. Review the note, then click Enable Secret Protection. That turns on secret scanning alerts.
5. In the Secret Protection section, to the right of Push protection, click Enable.

Alerts then show on the Security and quality tab. A push that contains a supported secret is blocked. A bypass opens an alert.

A read of repository metadata with this token returned `security_and_analysis` as null, so this report does not say the toggles are already on or already off.

## Install the Socket GitHub app

Do this in the GitHub UI. This job did not install the app.

1. Open `https://github.com/apps/socket-security`.
2. Click Install. If the `taylslate` organization already has the app, click Configure.
3. Choose the `taylslate` organization. An organization owner can install it. A repository admin can install it when the app asks for no organization permission, and then only on repositories they administer.
4. Choose Only select repositories, and select `taylslate`.
5. Approve the permissions GitHub shows.

Socket then comments on pull requests that change a dependency manifest, and it writes a project report for default-branch commits that touch those manifests. Socket's install doc says the app does not upload source code. Supported findings include malware, typo-squats, install scripts, and a few other dependency risks. npm is one of the ecosystems.

## What this scan did not do

- It did not rewrite git history.
- It did not rotate a key.
- It did not change GitHub, Vercel, Stripe, Supabase, or DocuSign settings.
- It did not download GitHub secret-scanning alerts. Those payloads can contain the secret. The scan stayed inside git objects.
- It did not edit application code, config, or `.gitignore`.
