// Start and check an ownership proof. Writes go through supabaseAdmin.
// The plaintext code leaves this module only as the start return value.
// Logs are the Postgres error code and an 8-character proof id prefix.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizeRssUrl } from "@/lib/reps/roster-import";
import {
  enforceRules,
  RATE_LIMIT_MESSAGE,
  type RateLimitRule,
} from "@/lib/security/rate-limit";
import {
  codeExpiresAt,
  generateOwnershipCode,
  hashOwnershipCode,
  isOwnershipCode,
  textContainsHashedCode,
} from "@/lib/ownership/code";
import { readRssProofText } from "@/lib/ownership/rss-proof";
import { readYoutubeDescription } from "@/lib/ownership/youtube-proof";

export const OWNERSHIP_START_DAY_MAX = 5;
export const OWNERSHIP_START_DAY_WINDOW_SEC = 24 * 60 * 60;
export const OWNERSHIP_CHECK_MINUTE_MAX = 1;
export const OWNERSHIP_CHECK_MINUTE_WINDOW_SEC = 60;
export const OWNERSHIP_CHECK_DAY_MAX = 20;
export const OWNERSHIP_CHECK_DAY_WINDOW_SEC = 24 * 60 * 60;
export const OWNERSHIP_MATCH_LIMIT = 5;

const UC_ID = /^UC[A-Za-z0-9_-]{22}$/;

export const OWNERSHIP_MESSAGES = {
  paste:
    "Paste this code in your show description or in a recent episode's notes. Once we see it you can delete it.",
  review: "We passed this to our team to review.",
  miss: "Not found yet. Feeds can take a while to update.",
  youtube: "We could not check YouTube right now. Try again later.",
  verified: "Verified",
} as const;

export const OWNERSHIP_ERRORS = {
  unauthorized: "Unauthorized",
  forbidden: "Forbidden",
  noFeed: "Add your RSS feed to your show profile first.",
  channel: "Paste your channel URL that starts with youtube.com/channel/.",
  noCatalog: "We could not find this show in the catalog yet.",
  medium: "Choose podcast or YouTube.",
  nothing: "Nothing to check.",
  unavailable: "unavailable",
  rate: RATE_LIMIT_MESSAGE,
} as const;

export type OwnershipMedium = "podcast" | "youtube";

export type OwnershipStartResult =
  | {
      ok: true;
      code: string;
      message: string;
      target: string;
      medium: OwnershipMedium;
    }
  | { ok: false; status: number; error: string };

export type OwnershipCheckOutcome = "verified" | "contested" | "expired" | "miss" | "unavailable";

export type OwnershipCheckResult =
  | { ok: true; outcome: OwnershipCheckOutcome; message: string }
  | { ok: false; status: number; error: string };

interface ProofRow {
  id: string;
  show_id: string;
  show_profile_id: string | null;
  method: string | null;
  status: string;
  code_hash: string | null;
  code_expires_at: string | null;
  target: string | null;
  check_count: number;
  miss_count: number;
  created_at: string;
}

interface DbError {
  code?: string;
  message?: string;
}

function logOwnershipError(code: string | undefined, proofId?: string | null): void {
  const prefix = proofId ? proofId.slice(0, 8) : "";
  console.error("[ownership]", code ?? "unknown", prefix);
}

function unavailable(): OwnershipStartResult {
  return { ok: false, status: 503, error: OWNERSHIP_ERRORS.unavailable };
}

export function ownershipStartRules(userId: string): RateLimitRule[] {
  return [
    {
      bucket: "ownership_start_user_day",
      key: userId,
      max: OWNERSHIP_START_DAY_MAX,
      windowSeconds: OWNERSHIP_START_DAY_WINDOW_SEC,
    },
  ];
}

export function ownershipCheckRules(userId: string): RateLimitRule[] {
  return [
    {
      bucket: "ownership_check_user_minute",
      key: userId,
      max: OWNERSHIP_CHECK_MINUTE_MAX,
      windowSeconds: OWNERSHIP_CHECK_MINUTE_WINDOW_SEC,
    },
    {
      bucket: "ownership_check_user_day",
      key: userId,
      max: OWNERSHIP_CHECK_DAY_MAX,
      windowSeconds: OWNERSHIP_CHECK_DAY_WINDOW_SEC,
    },
  ];
}

export function enforceOwnershipStart(userId: string): Promise<NextResponse | null> {
  return enforceRules({ rules: ownershipStartRules(userId), failureMode: "closed" });
}

export function enforceOwnershipCheck(userId: string): Promise<NextResponse | null> {
  return enforceRules({ rules: ownershipCheckRules(userId), failureMode: "closed" });
}

/** Apex taylslate.com is the www host. A missing Origin is refused. */
export function requestIsSameOrigin(originHeader: string | null): boolean {
  if (!originHeader) return false;
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? "";
  if (!raw) return false;
  let expected: URL;
  let actual: URL;
  try {
    expected = new URL(raw);
    actual = new URL(originHeader);
  } catch {
    return false;
  }
  if (expected.hostname === "taylslate.com") {
    expected.hostname = "www.taylslate.com";
    expected.protocol = "https:";
  }
  return actual.origin === expected.origin;
}

export function parseYoutubeChannelTarget(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 300) return null;
  if (UC_ID.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "youtube.com" && host !== "m.youtube.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "channel" && parts[1] && UC_ID.test(parts[1])) return parts[1];
  return null;
}

function likeContains(value: string): string {
  const escaped = value.replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}

function rssStoredVariants(norm: string): string[] {
  return [
    norm,
    `${norm}/`,
    `https://${norm}`,
    `https://${norm}/`,
    `http://${norm}`,
    `http://${norm}/`,
  ];
}

function feedFetchUrl(target: string): string {
  if (/^https?:\/\//i.test(target)) return target;
  return `https://${target}`;
}

async function matchingShowIds(
  medium: OwnershipMedium,
  target: string
): Promise<{ ok: true; ids: string[] } | { ok: false; error: DbError }> {
  if (medium === "youtube") {
    const { data, error } = await supabaseAdmin
      .from("shows")
      .select("id")
      .eq("youtube_channel_id", target)
      .order("id", { ascending: true })
      .limit(OWNERSHIP_MATCH_LIMIT);
    if (error) return { ok: false, error };
    const ids = (data ?? [])
      .map((row) => (typeof row.id === "string" ? row.id : ""))
      .filter((id) => id.length > 0);
    return { ok: true, ids };
  }

  const [exact, fuzzy] = await Promise.all([
    supabaseAdmin.from("shows").select("id, rss_url").in("rss_url", rssStoredVariants(target)),
    supabaseAdmin
      .from("shows")
      .select("id, rss_url")
      .ilike("rss_url", likeContains(target))
      .limit(20),
  ]);
  if (exact.error) return { ok: false, error: exact.error };
  if (fuzzy.error) return { ok: false, error: fuzzy.error };

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of [...(exact.data ?? []), ...(fuzzy.data ?? [])]) {
    const id = typeof row.id === "string" ? row.id : "";
    const rss = typeof row.rss_url === "string" ? row.rss_url : "";
    if (!id || !rss || seen.has(id)) continue;
    if (normalizeRssUrl(rss) !== target) continue;
    seen.add(id);
    ids.push(id);
  }
  ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { ok: true, ids: ids.slice(0, OWNERSHIP_MATCH_LIMIT) };
}

export async function startOwnership(input: {
  userId: string;
  showProfileId: string;
  medium: OwnershipMedium;
  channel?: string;
  now?: Date;
}): Promise<OwnershipStartResult> {
  const now = input.now ?? new Date();
  let target = "";
  if (input.medium === "podcast") {
    const { data, error } = await supabaseAdmin
      .from("show_profiles")
      .select("feed_url")
      .eq("id", input.showProfileId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (error) {
      logOwnershipError(error.code);
      return unavailable();
    }
    const feed = typeof data?.feed_url === "string" ? data.feed_url.trim() : "";
    if (!feed) return { ok: false, status: 400, error: OWNERSHIP_ERRORS.noFeed };
    target = normalizeRssUrl(feed);
    if (!target) return { ok: false, status: 400, error: OWNERSHIP_ERRORS.noFeed };
  } else {
    const channelId = parseYoutubeChannelTarget(input.channel ?? "");
    if (!channelId) return { ok: false, status: 400, error: OWNERSHIP_ERRORS.channel };
    target = channelId;
  }

  const shows = await matchingShowIds(input.medium, target);
  if (!shows.ok) {
    logOwnershipError(shows.error.code);
    return unavailable();
  }
  if (shows.ids.length === 0) {
    return { ok: false, status: 409, error: OWNERSHIP_ERRORS.noCatalog };
  }

  const expired = await supabaseAdmin
    .from("show_ownership_proofs")
    .update({
      status: "expired",
      code_hash: null,
      updated_at: now.toISOString(),
    })
    .eq("user_id", input.userId)
    .eq("target", target)
    .eq("status", "pending");
  if (expired.error) {
    logOwnershipError(expired.error.code);
    return unavailable();
  }

  const code = generateOwnershipCode();
  if (!isOwnershipCode(code)) return unavailable();
  const codeHash = hashOwnershipCode(code);
  const rows = shows.ids.map((showId) => ({
    show_id: showId,
    user_id: input.userId,
    show_profile_id: input.showProfileId,
    method: input.medium === "podcast" ? "rss_code" : "youtube_code",
    status: "pending",
    code_hash: codeHash,
    code_expires_at: codeExpiresAt(now),
    target,
    check_count: 0,
    miss_count: 0,
  }));
  const inserted = await supabaseAdmin.from("show_ownership_proofs").insert(rows);
  if (inserted.error) {
    logOwnershipError(inserted.error.code);
    return unavailable();
  }

  return {
    ok: true,
    code,
    message: OWNERSHIP_MESSAGES.paste,
    target,
    medium: input.medium,
  };
}

async function loadPending(userId: string): Promise<{ ok: true; rows: ProofRow[] } | { ok: false; error: DbError }> {
  const { data, error } = await supabaseAdmin
    .from("show_ownership_proofs")
    .select(
      "id, show_id, show_profile_id, method, status, code_hash, code_expires_at, target, check_count, miss_count, created_at"
    )
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error };
  const rows: ProofRow[] = [];
  for (const row of data ?? []) {
    if (typeof row.id !== "string" || typeof row.show_id !== "string") continue;
    rows.push({
      id: row.id,
      show_id: row.show_id,
      show_profile_id: typeof row.show_profile_id === "string" ? row.show_profile_id : null,
      method: typeof row.method === "string" ? row.method : null,
      status: typeof row.status === "string" ? row.status : "pending",
      code_hash: typeof row.code_hash === "string" ? row.code_hash : null,
      code_expires_at: typeof row.code_expires_at === "string" ? row.code_expires_at : null,
      target: typeof row.target === "string" ? row.target : null,
      check_count: typeof row.check_count === "number" ? row.check_count : 0,
      miss_count: typeof row.miss_count === "number" ? row.miss_count : 0,
      created_at: typeof row.created_at === "string" ? row.created_at : "",
    });
  }
  return { ok: true, rows };
}

async function updateProof(
  userId: string,
  proofId: string,
  patch: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; code?: string }> {
  const { error } = await supabaseAdmin
    .from("show_ownership_proofs")
    .update(patch)
    .eq("id", proofId)
    .eq("user_id", userId)
    .eq("status", "pending");
  if (error) {
    logOwnershipError(error.code, proofId);
    return { ok: false, code: error.code };
  }
  return { ok: true };
}

function checkedPatch(row: ProofRow, nowIso: string, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    ...extra,
    check_count: row.check_count + 1,
    last_checked_at: nowIso,
    updated_at: nowIso,
  };
}

async function showAlreadyVerified(showId: string): Promise<{ ok: true; verified: boolean } | { ok: false; error: DbError }> {
  const { data, error } = await supabaseAdmin
    .from("show_ownership_proofs")
    .select("id")
    .eq("show_id", showId)
    .eq("status", "verified")
    .limit(1);
  if (error) return { ok: false, error };
  return { ok: true, verified: (data ?? []).length > 0 };
}

async function exclusiveOtherAgent(
  showId: string,
  userId: string
): Promise<{ ok: true; conflict: boolean } | { ok: false; error: DbError }> {
  const { data, error } = await supabaseAdmin
    .from("agent_show_relationships")
    .select("agent_id")
    .eq("show_id", showId)
    .eq("status", "approved")
    .eq("is_exclusive", true);
  if (error) return { ok: false, error };
  const conflict = (data ?? []).some((row) => row.agent_id !== userId);
  return { ok: true, conflict };
}

async function markShowVerified(showId: string, proofId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("shows")
    .update({ ownership_status: "verified" })
    .eq("id", showId);
  if (error) logOwnershipError(error.code, proofId);
}

type RowOutcome = "verified" | "contested" | "expired" | "miss" | "unavailable" | "error";

async function contest(row: ProofRow, userId: string, nowIso: string): Promise<RowOutcome> {
  const updated = await updateProof(
    userId,
    row.id,
    checkedPatch(row, nowIso, { status: "contested", note: "needs_admin_review" })
  );
  return updated.ok ? "contested" : "error";
}

async function applyHit(row: ProofRow, userId: string, nowIso: string): Promise<RowOutcome> {
  const verified = await showAlreadyVerified(row.show_id);
  if (!verified.ok) {
    logOwnershipError(verified.error.code, row.id);
    return contest(row, userId, nowIso);
  }
  const exclusive = await exclusiveOtherAgent(row.show_id, userId);
  if (!exclusive.ok) {
    logOwnershipError(exclusive.error.code, row.id);
    return contest(row, userId, nowIso);
  }
  if (verified.verified || exclusive.conflict) return contest(row, userId, nowIso);

  const updated = await updateProof(
    userId,
    row.id,
    checkedPatch(row, nowIso, {
      status: "verified",
      verified_at: nowIso,
      code_hash: null,
    })
  );
  if (!updated.ok) {
    if (updated.code === "23505") return contest(row, userId, nowIso);
    return "error";
  }
  await markShowVerified(row.show_id, row.id);
  return "verified";
}

function messageFor(outcomes: RowOutcome[]): OwnershipCheckResult {
  if (outcomes.length === 0) {
    return { ok: false, status: 503, error: OWNERSHIP_ERRORS.unavailable };
  }
  if (outcomes.every((outcome) => outcome === "error")) {
    return { ok: false, status: 503, error: OWNERSHIP_ERRORS.unavailable };
  }
  if (outcomes.some((outcome) => outcome === "unavailable")) {
    return { ok: true, outcome: "unavailable", message: OWNERSHIP_MESSAGES.youtube };
  }
  if (outcomes.some((outcome) => outcome === "expired")) {
    return { ok: true, outcome: "expired", message: OWNERSHIP_MESSAGES.review };
  }
  if (outcomes.some((outcome) => outcome === "contested" || outcome === "error")) {
    return { ok: true, outcome: "contested", message: OWNERSHIP_MESSAGES.review };
  }
  if (outcomes.every((outcome) => outcome === "verified")) {
    return { ok: true, outcome: "verified", message: OWNERSHIP_MESSAGES.verified };
  }
  return { ok: true, outcome: "miss", message: OWNERSHIP_MESSAGES.miss };
}

export async function checkOwnership(input: {
  userId: string;
  now?: Date;
}): Promise<OwnershipCheckResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const loaded = await loadPending(input.userId);
  if (!loaded.ok) {
    logOwnershipError(loaded.error.code);
    return { ok: false, status: 503, error: OWNERSHIP_ERRORS.unavailable };
  }
  const pending = loaded.rows.filter((row) => row.target);
  if (pending.length === 0) {
    return { ok: false, status: 400, error: OWNERSHIP_ERRORS.nothing };
  }
  const target = pending[0].target;
  const rows = pending.filter((row) => row.target === target);
  const expiresAt = rows[0]?.code_expires_at;
  if (expiresAt && new Date(expiresAt).getTime() <= now.getTime()) {
    const outcomes: RowOutcome[] = [];
    for (const row of rows) {
      const updated = await updateProof(
        input.userId,
        row.id,
        checkedPatch(row, nowIso, { status: "expired", code_hash: null })
      );
      outcomes.push(updated.ok ? "expired" : "error");
    }
    return messageFor(outcomes);
  }

  const method = rows[0]?.method;
  let sawCode = false;
  let unavailableRead = false;
  let countedMiss = false;

  if (method === "youtube_code") {
    const read = await readYoutubeDescription(target ?? "");
    if (read.status === "unavailable") unavailableRead = true;
    else {
      const hash = rows.find((row) => row.code_hash)?.code_hash ?? "";
      sawCode = hash.length > 0 && textContainsHashedCode(read.description, hash);
      countedMiss = !sawCode;
    }
  } else if (method === "rss_code") {
    const read = await readRssProofText(feedFetchUrl(target ?? ""));
    if (read.status === "ok") {
      const hash = rows.find((row) => row.code_hash)?.code_hash ?? "";
      sawCode = hash.length > 0 && textContainsHashedCode(read.text, hash);
      countedMiss = !sawCode;
    } else {
      countedMiss = true;
    }
  } else {
    countedMiss = true;
  }

  if (unavailableRead) {
    const outcomes: RowOutcome[] = [];
    for (const row of rows) {
      const updated = await updateProof(
        input.userId,
        row.id,
        checkedPatch(row, nowIso, {})
      );
      outcomes.push(updated.ok ? "unavailable" : "error");
    }
    return messageFor(outcomes);
  }

  if (!sawCode) {
    const outcomes: RowOutcome[] = [];
    for (const row of rows) {
      const misses = row.miss_count + (countedMiss ? 1 : 0);
      const contested = countedMiss && misses >= 5;
      const updated = await updateProof(
        input.userId,
        row.id,
        checkedPatch(row, nowIso, {
          miss_count: misses,
          ...(contested ? { status: "contested", note: "needs_admin_review" } : {}),
        })
      );
      if (!updated.ok) outcomes.push("error");
      else outcomes.push(contested ? "contested" : "miss");
    }
    return messageFor(outcomes);
  }

  const outcomes: RowOutcome[] = [];
  for (const row of rows) outcomes.push(await applyHit(row, input.userId, nowIso));
  return messageFor(outcomes);
}
