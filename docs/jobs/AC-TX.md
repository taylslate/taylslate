# AC-TX: Move aircheck transcription to Deepgram Nova-3

No page or component was edited. Screenshots are not applicable. No migration. No SQL.

Grounded at main `b7efa4a` (SEC6, #93). Branched from `87d7a6c` (CLEAN1, #94). CLEAN1 did not touch `lib/airchecks`.

## Why

OpenAI deprecated `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, and `gpt-4o-transcribe-diarize` on Aug 26, 2026, with removal on Feb 26, 2027. The file replacement is `gpt-transcribe` at $0.0045 per minute. It returns JSON text and does not return segment or word timestamps. OpenAI says to keep `whisper-1` for word timestamps or srt and vtt until shutdown. After Feb 26, 2027 there is no OpenAI file model with timestamps.

The runner depends on timestamps. `whisper-1` is called with `verbose_json` and segment granularity. `locateAdRead` uses segments for the ad start, the placement zone, and the read length. Without segments, `adStart` is null, so position and length are always missing, confidence tops out at 0.75 instead of 1.0, and the reasons lose "Brand found at mm:ss". Readiness is unaffected.

Deepgram Nova-3 pre-recorded returns `results.utterances[]` with start, end, and transcript. It costs $0.0043 per minute, plus $0.0013 per minute for Keyterm Prompting (up to 100 terms). That is $0.0056 per minute with keyterms, against whisper-1 at $0.006. `mip_opt_out=true` opts out of the Model Improvement Program. Pay as You Go customers can do so with no change to listed pricing.

`gpt-transcribe` (text only) is not built.

## Sources

- https://developers.openai.com/api/docs/deprecations (verified Nov 10, 2026)
- https://developers.openai.com/api/docs/models/gpt-transcribe
- https://developers.openai.com/api/docs/guides/speech-to-text
- https://developers.openai.com/cookbook/examples/migrating_from_whisper_to_gpt_transcribe
- https://developers.deepgram.com/docs/utterances
- https://deepgram.com/pricing
- https://developers.deepgram.com/docs/keyterm
- https://developers.deepgram.com/trust-security/your-data
- https://developers.deepgram.com/changelog/2026/3/5.md

## Decisions locked (Chris, 2026-11-11)

- Editing `lib/airchecks` is OK for the Owns files only. `review.ts`, `select.ts`, `persist.ts`, `locate.ts`, `match.ts`, `episode.ts`, `detect.ts`, `rss.ts`, and `window.ts` stay untouched.
- Provider: Deepgram Nova-3 behind `TranscriptProvider`, Pay as You Go, `mip_opt_out=true`. Chris opens the account in his name, accepts the DPA, and sets `DEEPGRAM_API_KEY` in Vercel Production himself. This PR does not change Vercel env.
- Fallback: whisper-1 only when `DEEPGRAM_API_KEY` is missing, `OPENAI_API_KEY` is set, and the time is before `2027-02-26T00:00:00Z`. Otherwise skip with a logged reason. The cron still returns 200. A provider error on one spot stays on that spot.
- Keyterms: brand names, promo code, and URL host are sent. `redact_usage=true` is also sent, so those terms are not kept in Deepgram usage records. Chris confirmed this default on Nov 11, 2026.

## Env

`DEEPGRAM_API_KEY` is the one new env name. It is not set by this PR. `.env.example` is owned by AC-YT, which adds the line. `OPENAI_API_KEY` is the existing fallback key and is not set in Vercel (per Angus, and confirmed Nov 10, 2026). `AIRCHECK_RUN_COST_CAP_USD` is unchanged and optional.

Until `DEEPGRAM_API_KEY` is set, the cron skips with `missing_transcription_api_key` unless `OPENAI_API_KEY` is set before the shutdown date.

## Precheck

Read only, project `ldtmhafewfifdizgfrnn`, Nov 11, 2026. No rows written.

The status list is `BOOKED_DEAL_STATUSES` in `lib/discovery/market-signals.ts` (`show_signed`, `delivering`, `completed`, `signed`, `live`).

| Check | Result |
| --- | --- |
| `public.airchecks` | 0 |
| distinct `provider` values | null |
| recent booked lines (post date within 14 days) | 0 |

That matches the Nov 10, 2026 expectation (0, null, 0). Coding continued.

## What changed

- `lib/airchecks/provider.ts`: optional `hints` on `TranscriptionAudio`.
- `lib/airchecks/deepgram.ts`: Nova-3 provider. Query: `model=nova-3`, `utterances=true`, `smart_format=true`, `punctuate=true`, `mip_opt_out=true`, `redact_usage=true`, and one `keyterm` per hint (max 20, 60 characters, deduped). Body is the raw bytes. Header `Authorization: Token <key>`. 120 second timeout. Utterances map to segments. Failures are `missing_api_key`, `http`, `invalid`, or `empty`, passed through `redactAircheckError`. The key, the audio, and the transcript are not logged.
- `lib/airchecks/provider-select.ts`: Deepgram, else whisper-1 before shutdown, else id `none`. Exports `WHISPER_1_SHUTDOWN_UTC`. Never throws.
- `lib/airchecks/cost.ts`: `DEEPGRAM_USD_PER_MINUTE = 0.0056` and `estimateTranscriptCostUsd`. `estimateWhisperCostUsd` is now a wrapper. The cap default is unchanged.
- `lib/airchecks/run.ts`: selects the provider, skips with `missing_transcription_api_key`, logs the whisper fallback once per run, prices every estimate at `provider.usdPerMinute`, and passes hints. No other control flow change.
- `lib/airchecks/openai-whisper.ts` is unchanged. It is not selected on or after Feb 26, 2027.

`app/api/cron/airchecks` was not edited. The route returns the report as it is. `transcribe-audio.ts` (the admin step) is out of scope.

## Apply order

No migration and no SQL. Order-independent with AC-YT: AC-YT edits no file under `lib/airchecks` and this job does not touch the cron route. Independent of AC3: the Owns lists under `lib/airchecks` are disjoint. `deepgram.ts` and `provider-select.ts` do not import `review.ts`, `lib/delivery`, `lib/stripe`, `lib/payouts`, or `lib/billing`.

Shared file: `docs/SENIOR_DEV_HANDOFF.md` only. This job edits the transcription and cost paragraphs and appends the AC-TX section. A later PR rebases that file.

Deploy before Feb 26, 2027. The change is inert until `DEEPGRAM_API_KEY` is set.

## Follow-ups

- After Feb 26, 2027: delete `openai-whisper.ts`, the `WHISPER_*` constants, and the Whisper name on `splitAudioForWhisper`. Keep the splitter.
- `transcribe-audio.ts` could reuse the selected provider.
- Rename the old `missing_openai_api_key` literal on `AircheckRunReport.skipped` once nothing reads it. The cron route test still returns that string from its mock. The route was not edited.
