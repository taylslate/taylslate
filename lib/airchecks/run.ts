// Automated airchecks, parts 1 and 2.
// For each booked IO spot whose air window is open: pull that episode,
// transcribe it, store the text and segments, delete the audio, then
// store a match judgment and mark the row ready for review.
// This module does not mark a line delivered and does not charge.

import { logEvent as writeEvent } from "@/lib/data/events";
import type { LogEventInput } from "@/lib/data/events";
import { redactAircheckError } from "./redact";
import {
  downloadEpisodeAudio,
  splitAudioForWhisper,
  type DownloadedAudio,
} from "./audio";
import {
  aircheckCostLog,
  estimateSecondsFromBytes,
  estimateWhisperCostUsd,
  readRunCostCapUsd,
  roundMinutes,
  roundUsd,
} from "./cost";
import { findPodcastEpisode, findYoutubeEpisode, youtubeClientFromEnv } from "./episode";
import type { FoundEpisode } from "./episode";
import { locateAdRead } from "./locate";
import { saveAircheckRun, type AircheckPersist } from "./persist";
import { createOpenAiWhisperProvider } from "./openai-whisper";
import type { TranscriptProvider } from "./provider";
import { aircheckColumnsReady, loadDueSpots, type DueSpot } from "./select";
import type { AircheckSegment } from "./types";

const MAX_ERROR = 2000;
/** Stop starting new spots well inside the 300s function limit. */
export const AIRCHECK_RUN_BUDGET_MS = 200_000;

export interface AircheckRunReport {
  skipped: "missing_openai_api_key" | "migration_079" | null;
  stopped: "cost_cap" | "time" | null;
  capUsd: number;
  spentUsd: number;
  considered: number;
  transcribed: number;
  readyForReview: number;
  failed: number;
  youtubeWithoutAudio: number;
}

export interface AircheckRunDeps {
  now: Date;
  provider: TranscriptProvider;
  capUsd: number;
  columnsReady: () => Promise<boolean>;
  loadSpots: (now: Date) => Promise<DueSpot[]>;
  findEpisode: (spot: DueSpot) => Promise<FoundEpisode | { error: string }>;
  download: (url: string) => Promise<{ ok: true; audio: DownloadedAudio } | { ok: false; error: string }>;
  save: (row: AircheckPersist) => Promise<{ id: string }>;
  record: (input: LogEventInput) => Promise<unknown>;
  log: (line: string) => void;
  splitAudio: (bytes: Uint8Array) => Uint8Array[] | null;
  clock: () => number;
  timeBudgetMs: number;
}

function clip(message: string): string {
  const trimmed = redactAircheckError(message).trim();
  if (trimmed.length <= MAX_ERROR) return trimmed;
  return trimmed.slice(0, MAX_ERROR);
}

function isFound(value: FoundEpisode | { error: string }): value is FoundEpisode {
  return !("error" in value);
}

async function defaultFindEpisode(spot: DueSpot): Promise<FoundEpisode | { error: string }> {
  if (spot.format === "youtube") {
    return findYoutubeEpisode({
      channelId: spot.youtubeChannelId,
      episodeUrl: spot.episodeUrl,
      postDate: spot.postDate,
      window: spot.window,
      client: youtubeClientFromEnv(),
    });
  }
  return findPodcastEpisode({
    rssUrl: spot.rssUrl,
    episodeUrl: spot.episodeUrl,
    postDate: spot.postDate,
    window: spot.window,
  });
}

function failureRow(spot: DueSpot, message: string, episode?: FoundEpisode): AircheckPersist {
  return {
    io_line_item_id: spot.ioLineItemId,
    episode_identifier: episode?.episodeIdentifier ?? spot.episodeUrl,
    audio_url: episode?.audioUrl ?? null,
    transcript_text: null,
    provider: null,
    status: "failed",
    error: clip(message),
    window_start: spot.window.start,
    window_end: spot.window.end,
    ready_for_review: false,
  };
}

export function defaultAircheckDeps(now = new Date()): AircheckRunDeps {
  return {
    now,
    provider: createOpenAiWhisperProvider(),
    capUsd: readRunCostCapUsd(),
    columnsReady: aircheckColumnsReady,
    loadSpots: loadDueSpots,
    findEpisode: defaultFindEpisode,
    download: downloadEpisodeAudio,
    save: saveAircheckRun,
    record: writeEvent,
    log: (line) => console.info(line),
    splitAudio: splitAudioForWhisper,
    clock: () => Date.now(),
    timeBudgetMs: AIRCHECK_RUN_BUDGET_MS,
  };
}

async function transcribeFile(
  provider: TranscriptProvider,
  audio: DownloadedAudio,
  budget: { spent: number; cap: number; add: (usd: number) => void },
  splitAudio: (bytes: Uint8Array) => Uint8Array[] | null
): Promise<
  | { ok: true; text: string; segments: AircheckSegment[]; durationSeconds: number }
  | { ok: false; message: string; capped: boolean }
> {
  const pieces = splitAudio(audio.bytes);
  if (!pieces) {
    return {
      ok: false,
      capped: false,
      message: "Episode audio is over 24MB and is not an mp3 this runner can split for Whisper",
    };
  }
  const texts: string[] = [];
  const segments: AircheckSegment[] = [];
  let durationSeconds = 0;
  for (const piece of pieces) {
    const pieceEstimate = estimateWhisperCostUsd(estimateSecondsFromBytes(piece.byteLength));
    if (budget.spent >= budget.cap || budget.spent + pieceEstimate > budget.cap) {
      return {
        ok: false,
        capped: true,
        message: "Aircheck run cost cap reached before the next Whisper chunk",
      };
    }
    const result = await provider.transcribe({
      bytes: piece,
      filename: audio.filename,
      mimeType: audio.mimeType,
    });
    if (!result.ok) return { ok: false, capped: false, message: result.message };
    budget.add(estimateWhisperCostUsd(result.durationSeconds));
    const offset = durationSeconds;
    texts.push(result.text);
    for (const segment of result.segments) {
      segments.push({
        start_seconds: segment.start_seconds + offset,
        end_seconds: segment.end_seconds + offset,
        text: segment.text,
      });
    }
    durationSeconds += result.durationSeconds > 0 ? result.durationSeconds : 0;
  }
  const text = texts.join(" ").trim();
  if (!text) return { ok: false, capped: false, message: "Whisper returned an empty transcript" };
  return { ok: true, text, segments, durationSeconds };
}

export async function runAutomatedAirchecks(
  overrides: Partial<AircheckRunDeps> = {}
): Promise<AircheckRunReport> {
  const deps: AircheckRunDeps = { ...defaultAircheckDeps(), ...overrides };
  const report: AircheckRunReport = {
    skipped: null,
    stopped: null,
    capUsd: deps.capUsd,
    spentUsd: 0,
    considered: 0,
    transcribed: 0,
    readyForReview: 0,
    failed: 0,
    youtubeWithoutAudio: 0,
  };

  if (!deps.provider.isConfigured()) {
    report.skipped = "missing_openai_api_key";
    deps.log("[aircheck] skipped missing OPENAI_API_KEY");
    return report;
  }
  if (deps.capUsd <= 0) {
    report.stopped = "cost_cap";
    deps.log(`[aircheck] stopped cost cap ${deps.capUsd.toFixed(4)}`);
    return report;
  }
  if (!(await deps.columnsReady())) {
    report.skipped = "migration_079";
    deps.log("[aircheck] skipped migration 079 is not applied");
    return report;
  }

  const spots = await deps.loadSpots(deps.now);
  let spent = 0;
  const started = deps.clock();

  for (const spot of spots) {
    if (deps.clock() - started >= deps.timeBudgetMs) {
      report.stopped = "time";
      deps.log("[aircheck] stopped time budget");
      break;
    }
    report.considered += 1;
    const tally = { usd: 0 };
    try {
      const outcome = await processSpot(spot, deps, spent, tally);
      spent = roundUsd(spent + tally.usd);
      report.spentUsd = spent;
      if (outcome.stop) {
        report.stopped = "cost_cap";
        if (tally.usd === 0) report.considered -= 1;
        deps.log(`[aircheck] stopped cost cap spent_usd=${spent.toFixed(4)}`);
        break;
      }
      if (outcome.transcribed) report.transcribed += 1;
      if (outcome.readyForReview) report.readyForReview += 1;
      if (outcome.failed) report.failed += 1;
      if (outcome.youtubeWithoutAudio) report.youtubeWithoutAudio += 1;
    } catch (err) {
      spent = roundUsd(spent + tally.usd);
      report.spentUsd = spent;
      report.failed += 1;
      const message = err instanceof Error ? err.message : "Aircheck failed";
      deps.log(`[aircheck] line=${spot.ioLineItemId} failed ${clip(message)}`);
      try {
        await deps.save(failureRow(spot, message));
      } catch (saveErr) {
        const saveMessage = saveErr instanceof Error ? saveErr.message : "save failed";
        deps.log(`[aircheck] line=${spot.ioLineItemId} save failed ${clip(saveMessage)}`);
      }
    }
  }

  return report;
}

interface SpotOutcome {
  stop: boolean;
  spentUsd: number;
  transcribed: boolean;
  readyForReview: boolean;
  failed: boolean;
  youtubeWithoutAudio: boolean;
}

async function storeJudgment(
  deps: AircheckRunDeps,
  spot: DueSpot,
  base: AircheckPersist,
  transcript: string,
  segments: AircheckSegment[] | null,
  durationSeconds: number | null
): Promise<{ id: string; ready: boolean }> {
  const located = locateAdRead({
    status: "transcribed",
    transcript,
    segments: segments ?? [],
    durationSeconds,
    buy: spot.buy,
  });
  const saved = await deps.save({
    ...base,
    transcript_text: transcript,
    ...(segments ? { transcript_segments: segments } : {}),
    status: "transcribed",
    error: null,
    ready_for_review: located.readyForReview,
    confidence: located.confidence,
    ad_start_seconds: located.adStartSeconds,
    ad_end_seconds: located.adEndSeconds,
    match_reasons: located.reasons,
    match_result: located.judgment.match_result,
    match_evidence: located.judgment.match_evidence,
    matched_at: located.readyForReview ? new Date().toISOString() : null,
  });
  if (located.readyForReview) {
    await deps.record({
      eventType: "aircheck.ready_for_review",
      entityType: "aircheck",
      entityId: saved.id,
      payload: {
        io_line_item_id: spot.ioLineItemId,
        match_result: located.judgment.match_result,
        confidence: located.confidence,
        ad_start_seconds: located.adStartSeconds,
        ad_end_seconds: located.adEndSeconds,
      },
    });
  }
  return { id: saved.id, ready: located.readyForReview };
}

async function processSpot(
  spot: DueSpot,
  deps: AircheckRunDeps,
  spent: number,
  tally: { usd: number }
): Promise<SpotOutcome> {
  const none: SpotOutcome = {
    stop: false,
    spentUsd: 0,
    transcribed: false,
    readyForReview: false,
    failed: false,
    youtubeWithoutAudio: false,
  };

  if (spot.existingTranscript) {
    const saved = await storeJudgment(
      deps,
      spot,
      {
        io_line_item_id: spot.ioLineItemId,
        status: "transcribed",
        error: null,
        window_start: spot.window.start,
        window_end: spot.window.end,
      },
      spot.existingTranscript,
      null,
      null
    );
    return { ...none, readyForReview: saved.ready };
  }

  const found = await deps.findEpisode(spot);
  if (!isFound(found)) {
    await deps.save(failureRow(spot, found.error));
    return { ...none, failed: true };
  }
  if (!found.audioUrl) {
    await deps.save(failureRow(spot, found.note ?? "No episode audio URL", found));
    return {
      ...none,
      failed: true,
      youtubeWithoutAudio: spot.format === "youtube",
    };
  }

  const knownSeconds = found.durationSeconds;
  if (knownSeconds && knownSeconds > 0) {
    const estimate = estimateWhisperCostUsd(knownSeconds);
    if (spent + estimate > deps.capUsd) return { ...none, stop: true };
  }

  const downloaded = await deps.download(found.audioUrl);
  if (!downloaded.ok) {
    await deps.save(failureRow(spot, downloaded.error, found));
    return { ...none, failed: true };
  }

  const fromFeed = knownSeconds && knownSeconds > 0 ? knownSeconds : 0;
  const fromSize = estimateSecondsFromBytes(downloaded.audio.bytes.byteLength);
  const estimateSeconds = Math.max(fromFeed, fromSize);
  const estimate = estimateWhisperCostUsd(estimateSeconds);
  if (spent + estimate > deps.capUsd) return { ...none, stop: true };

  const budget = {
    get spent() {
      return spent + tally.usd;
    },
    cap: deps.capUsd,
    add(usd: number) {
      tally.usd = roundUsd(tally.usd + usd);
    },
  };
  const transcribed = await transcribeFile(
    deps.provider,
    downloaded.audio,
    budget,
    deps.splitAudio
  );
  if (!transcribed.ok) {
    if (tally.usd > 0 || !transcribed.capped) {
      await deps.save(failureRow(spot, transcribed.message, found));
    }
    return { ...none, failed: tally.usd > 0 || !transcribed.capped, stop: transcribed.capped };
  }

  const minutes = roundMinutes(transcribed.durationSeconds);
  const cost = estimateWhisperCostUsd(transcribed.durationSeconds);
  deps.log(
    aircheckCostLog({
      ioLineItemId: spot.ioLineItemId,
      minutes,
      estimatedCostUsd: cost,
      provider: deps.provider.id,
    })
  );

  const saved = await storeJudgment(
    deps,
    spot,
    {
      io_line_item_id: spot.ioLineItemId,
      episode_identifier: found.episodeIdentifier,
      audio_url: found.audioUrl,
      transcript_text: transcribed.text,
      provider: deps.provider.id,
      status: "transcribed",
      error: null,
      duration_seconds: transcribed.durationSeconds,
      audio_minutes: minutes,
      estimated_cost_usd: cost,
      window_start: spot.window.start,
      window_end: spot.window.end,
    },
    transcribed.text,
    transcribed.segments,
    transcribed.durationSeconds
  );

  await deps.record({
    eventType: "aircheck.transcribed",
    entityType: "aircheck",
    entityId: saved.id,
    payload: {
      io_line_item_id: spot.ioLineItemId,
      provider: deps.provider.id,
      audio_minutes: minutes,
      estimated_cost_usd: cost,
    },
  });

  return {
    ...none,
    spentUsd: cost,
    transcribed: true,
    readyForReview: saved.ready,
  };
}
