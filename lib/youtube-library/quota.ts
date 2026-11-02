// Daily YouTube Data API unit ledger. Google resets the default
// 10,000 unit quota at midnight Pacific Time. The library stops at
// YOUTUBE_DAILY_QUOTA_CAP (default 8,000, 80 percent). The pull leaves
// room for the refresh budget and, while video-description scans are
// still pending, for the email backfill. Usage is committed per call
// and logged once per job. The API key is never logged.

export const YOUTUBE_DAILY_QUOTA_UNITS = 10_000;
export const YOUTUBE_DAILY_QUOTA_CAP_DEFAULT = 8_000;
/** Matches lib/youtube-library/refresh.ts YOUTUBE_LIBRARY_REFRESH_BUDGET. */
export const YOUTUBE_REFRESH_QUOTA_RESERVE = 1_000;
/** Video-description backfill units held aside while scans are pending. */
export const YOUTUBE_EMAIL_BACKFILL_DAILY = 2_000;

export type QuotaJob = "pull" | "refresh" | "email_backfill";

export interface QuotaCommit {
  accepted: number;
  total: number;
}

export interface QuotaLedger {
  used(day: string): Promise<number>;
  commit(day: string, units: number, job: QuotaJob, cap: number): Promise<QuotaCommit>;
}

export interface QuotaSpend {
  ledger: QuotaLedger;
  day: string;
  /** Hard cap passed to commit. */
  cap: number;
  /** This job stops when the ledger would pass this absolute total. */
  spendCap: number;
  job: QuotaJob;
  emailReserve: number;
  refreshReserve: number;
}

export interface QuotaStore {
  yt2Ready(): Promise<boolean>;
  quotaLedger(): QuotaLedger;
  countUncheckedVideos(): Promise<number>;
}

/** Pacific calendar day, YYYY-MM-DD. YouTube's quota resets at midnight PT. */
export function pacificDay(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

/**
 * Integer cap from YOUTUBE_DAILY_QUOTA_CAP. Unset or invalid uses 8,000.
 * Pass a string to test a value without reading the environment.
 * Pass null to force the default.
 */
export function readDailyQuotaCap(raw?: string | null): number {
  const value = raw === undefined ? process.env.YOUTUBE_DAILY_QUOTA_CAP : raw;
  if (value == null || value.trim() === "") return YOUTUBE_DAILY_QUOTA_CAP_DEFAULT;
  if (!/^\d+$/.test(value.trim())) return YOUTUBE_DAILY_QUOTA_CAP_DEFAULT;
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 1_000_000) {
    return YOUTUBE_DAILY_QUOTA_CAP_DEFAULT;
  }
  return parsed;
}

export function createMemoryQuotaLedger(): QuotaLedger & {
  log: { day: string; units: number; job: QuotaJob }[];
} {
  const days = new Map<string, number>();
  const log: { day: string; units: number; job: QuotaJob }[] = [];
  return {
    log,
    async used(day) {
      return days.get(day) ?? 0;
    },
    async commit(day, units, job, cap) {
      const current = days.get(day) ?? 0;
      const accepted = Math.min(units, Math.max(cap - current, 0));
      if (accepted <= 0) return { accepted: 0, total: current };
      const total = current + accepted;
      days.set(day, total);
      log.push({ day, units: accepted, job });
      return { accepted, total };
    },
  };
}

/**
 * Open the shared ledger when migration 076 is present.
 * Returns null when the YT2 tables are not there yet.
 * Pull keeps 1,000 units for refresh, and 2,000 more while video
 * email scans are still pending. Refresh keeps the email reserve.
 * The email job may spend up to 2,000 units above the total it sees
 * at start, and never past the hard cap.
 */
export async function openLibraryQuota(
  store: QuotaStore,
  now: Date,
  job: QuotaJob
): Promise<QuotaSpend | null> {
  if (!(await store.yt2Ready())) return null;
  const cap = readDailyQuotaCap();
  const day = pacificDay(now);
  const ledger = store.quotaLedger();
  const unchecked = job === "email_backfill" ? 0 : await store.countUncheckedVideos();
  const emailReserve = unchecked > 0 ? Math.min(YOUTUBE_EMAIL_BACKFILL_DAILY, cap) : 0;
  const refreshReserve =
    job === "pull" ? Math.min(YOUTUBE_REFRESH_QUOTA_RESERVE, Math.max(cap - emailReserve, 0)) : 0;
  const used = job === "email_backfill" ? await ledger.used(day) : 0;
  let spendCap = Math.max(0, cap - emailReserve - refreshReserve);
  if (job === "refresh") spendCap = Math.max(0, cap - emailReserve);
  if (job === "email_backfill") spendCap = Math.min(cap, used + YOUTUBE_EMAIL_BACKFILL_DAILY);
  return { ledger, day, cap, spendCap, job, emailReserve, refreshReserve };
}

export function quotaLogLine(spend: QuotaSpend, total: number): string {
  return `[youtube-library] quota day=${spend.day} job=${spend.job} total=${total} cap=${spend.cap}`;
}
