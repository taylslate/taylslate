// Raw YouTube Analytics values. No derived score.
// reports.query is a separate quota and is not written to the Data API ledger.

import { googleFetch, youtubeErrorReason } from "./google";

const REPORTS_URL = "https://youtubeanalytics.googleapis.com/v2/reports";

export interface RetentionPoint {
  ratio: number;
  audience_watch_ratio: number | null;
  relative_retention_performance: number | null;
}

export interface VideoAnalytics {
  views: number | null;
  estimatedMinutesWatched: number | null;
  averageViewDurationSeconds: number | null;
}

export type AnalyticsFailure = "quota" | "http" | "empty" | "scope";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function analyticsWindow(input: {
  now: Date;
  publishedAt: string | null;
  attempts: number;
  hasViews: boolean;
}): "wait" | "due" | "expired" | "done" {
  if (input.hasViews || input.attempts >= 10) return "done";
  if (!input.publishedAt) return "wait";
  const published = Date.parse(input.publishedAt);
  if (!Number.isFinite(published)) return "wait";
  if (input.now.getTime() < published + 48 * HOUR_MS) return "wait";
  if (input.now.getTime() > published + 14 * DAY_MS) return "expired";
  return "due";
}

function dayStamp(iso: string | Date): string | null {
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function analyticsQueryUrl(input: {
  videoId: string;
  publishedAt: string;
  now: Date;
  retention: boolean;
}): string | null {
  const start = dayStamp(input.publishedAt);
  const end = dayStamp(input.now);
  if (!start || !end || !/^[A-Za-z0-9_-]{11}$/.test(input.videoId)) return null;
  const url = new URL(REPORTS_URL);
  url.searchParams.set("ids", "channel==MINE");
  url.searchParams.set("filters", `video==${input.videoId}`);
  url.searchParams.set("startDate", start);
  url.searchParams.set("endDate", end);
  if (input.retention) {
    url.searchParams.set("dimensions", "elapsedVideoTimeRatio");
    url.searchParams.set("metrics", "audienceWatchRatio,relativeRetentionPerformance");
  } else {
    url.searchParams.set("metrics", "views,estimatedMinutesWatched,averageViewDuration");
  }
  return url.toString();
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function rowsOf(body: Record<string, unknown> | null): unknown[][] {
  if (!Array.isArray(body?.rows)) return [];
  return body.rows.filter((row): row is unknown[] => Array.isArray(row));
}

export function parseVideoAnalytics(body: Record<string, unknown> | null): VideoAnalytics | null {
  const row = rowsOf(body)[0];
  if (!row) return null;
  return {
    views: num(row[0]),
    estimatedMinutesWatched: num(row[1]),
    averageViewDurationSeconds: num(row[2]),
  };
}

export function parseRetentionRows(body: Record<string, unknown> | null): RetentionPoint[] {
  const points: RetentionPoint[] = [];
  for (const row of rowsOf(body)) {
    const ratio = num(row[0]);
    if (ratio == null) continue;
    points.push({
      ratio,
      audience_watch_ratio: num(row[1]),
      relative_retention_performance: num(row[2]),
    });
  }
  points.sort((a, b) => a.ratio - b.ratio);
  return points;
}

/**
 * Points whose interval overlaps [adStart, adEnd], plus one point
 * either side. Each API ratio is the exclusive end of its interval.
 * The step is duration/100 when the API returns its usual 100 points.
 */
export function retentionPointsForAd(input: {
  points: RetentionPoint[];
  durationSeconds: number;
  adStartSeconds: number | null;
  adEndSeconds: number | null;
}): RetentionPoint[] {
  const { points, durationSeconds, adStartSeconds, adEndSeconds } = input;
  if (points.length === 0 || durationSeconds <= 0) return [];
  if (adStartSeconds == null || adEndSeconds == null || adEndSeconds < adStartSeconds) return [];
  const sorted = [...points].sort((a, b) => a.ratio - b.ratio);
  const overlapping: number[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const end = sorted[index].ratio * durationSeconds;
    const start = index === 0 ? 0 : sorted[index - 1].ratio * durationSeconds;
    if (start < adEndSeconds && end >= adStartSeconds) overlapping.push(index);
  }
  if (overlapping.length === 0) return [];
  const first = overlapping[0];
  const last = overlapping[overlapping.length - 1];
  const from = Math.max(0, first - 1);
  const to = Math.min(sorted.length - 1, last + 1);
  return sorted.slice(from, to + 1);
}

async function getReport(
  url: string,
  accessToken: string,
  fetchImpl: typeof fetch
): Promise<{ ok: true; body: Record<string, unknown> | null } | { ok: false; reason: AnalyticsFailure }> {
  const { status, text } = await googleFetch(
    url,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
    fetchImpl
  );
  const body = parseJson(text);
  const reason = youtubeErrorReason(body);
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded" || reason === "rateLimitExceeded") {
    return { ok: false, reason: "quota" };
  }
  if (status === 403 && reason === "forbidden") return { ok: false, reason: "scope" };
  if (status < 200 || status >= 300) return { ok: false, reason: "http" };
  return { ok: true, body };
}

export async function fetchVideoAnalytics(
  input: { accessToken: string; videoId: string; publishedAt: string; now: Date },
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; analytics: VideoAnalytics } | { ok: false; reason: AnalyticsFailure }> {
  const url = analyticsQueryUrl({ ...input, retention: false });
  if (!url) return { ok: false, reason: "empty" };
  const report = await getReport(url, input.accessToken, fetchImpl);
  if (!report.ok) return report;
  const analytics = parseVideoAnalytics(report.body);
  if (!analytics) return { ok: false, reason: "empty" };
  return { ok: true, analytics };
}

export async function fetchRetention(
  input: { accessToken: string; videoId: string; publishedAt: string; now: Date },
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; points: RetentionPoint[] } | { ok: false; reason: AnalyticsFailure }> {
  const url = analyticsQueryUrl({ ...input, retention: true });
  if (!url) return { ok: false, reason: "empty" };
  const report = await getReport(url, input.accessToken, fetchImpl);
  if (!report.ok) return report;
  return { ok: true, points: parseRetentionRows(report.body) };
}
