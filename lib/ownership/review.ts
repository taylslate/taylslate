// Admin ownership queue and the owner's manual review request.
// Writes go through supabaseAdmin. decided_by is the session user id.
// Logs are a route tag and a Postgres error code. No message, id, or email.

import { NextResponse } from "next/server";
import { getAuthEmail } from "@/lib/auth/auth-email";
import { isUuid } from "@/lib/api/v1/pagination";
import {
  matchingShowIds,
  OWNERSHIP_ERRORS,
  OWNERSHIP_MESSAGES,
  parseYoutubeChannelTarget,
  type OwnershipMedium,
} from "@/lib/ownership/check";
import { normalizeRssUrl } from "@/lib/reps/roster-import";
import { rosterRepLabel, type RepNameFields } from "@/lib/reps/roster-notify";
import { releaseHeldPayoutsForShow } from "@/lib/payouts/release";
import { rosterReviewNote } from "@/lib/reps/roster-review";
import { type RateLimitRule, RATE_LIMIT_MESSAGE } from "@/lib/security/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const OWNERSHIP_MANUAL_DAY_MAX = 3;
export const OWNERSHIP_MANUAL_DAY_WINDOW_SEC = 24 * 60 * 60;
export const ADMIN_OWNERSHIP_READ_MAX = 60;
export const ADMIN_OWNERSHIP_READ_WINDOW_SEC = 60;
export const ADMIN_OWNERSHIP_DECIDE_MAX = 20;
export const ADMIN_OWNERSHIP_DECIDE_WINDOW_SEC = 60;
export const OWNERSHIP_QUEUE_LIMIT = 100;
const OWNERSHIP_QUEUE_SCAN = 1000;
const BODY_MAX_BYTES = 8 * 1024;
const EXPLANATION_MIN = 20;
const EXPLANATION_MAX = 1000;
const LINK_MAX = 300;

const ADMIN_TAG = "[ownership-admin]";
const MANUAL_TAG = "[ownership-manual]";

export const OWNERSHIP_REVIEW_MIGRATION = "Ownership review needs migration 091.";
export const OWNERSHIP_ALREADY_DECIDED = "Already decided";
export const OWNERSHIP_ALREADY_VERIFIED = "This show already has a verified owner.";
export const OWNERSHIP_APPROVE_FAILED = "Couldn't approve that proof.";
export const OWNERSHIP_REJECT_FAILED = "Couldn't reject that proof.";
export const OWNERSHIP_REASON_REQUIRED = "A reason of 1 to 500 characters is required.";
export const OWNERSHIP_NOT_FOUND = "Not found";
export const OWNERSHIP_BAD_REQUEST = "Bad request.";
export const OWNERSHIP_DUPLICATE = "Your request is already with our team.";
export const OWNERSHIP_LINK_ERROR = "The link must be an https URL of at most 300 characters.";
export const OWNERSHIP_EXPLANATION_ERROR = "Explain the request in 20 to 1000 characters.";
export const OWNERSHIP_SIBLING_NOTE = "Another owner was verified.";
export const OWNERSHIP_LOAD_FAILED = "Couldn't load ownership reviews.";
export const OWNERSHIP_STATUS_FILTER = "Choose contested or expired.";
export const OWNERSHIP_ACTION = "Action must be approve or reject.";
export const OWNERSHIP_BODY_LARGE = "Request body is too large.";
export const OWNERSHIP_BODY_JSON = "Request body must be JSON.";
export const OWNERSHIP_BODY_INVALID = "Invalid JSON";

const REVIEW_ERROR_TEXT = new Set<string>([
  ...Object.values(OWNERSHIP_ERRORS),
  RATE_LIMIT_MESSAGE,
  OWNERSHIP_REVIEW_MIGRATION,
  OWNERSHIP_ALREADY_DECIDED,
  OWNERSHIP_ALREADY_VERIFIED,
  OWNERSHIP_APPROVE_FAILED,
  OWNERSHIP_REJECT_FAILED,
  OWNERSHIP_REASON_REQUIRED,
  OWNERSHIP_NOT_FOUND,
  OWNERSHIP_BAD_REQUEST,
  OWNERSHIP_DUPLICATE,
  OWNERSHIP_LINK_ERROR,
  OWNERSHIP_EXPLANATION_ERROR,
  OWNERSHIP_LOAD_FAILED,
  OWNERSHIP_STATUS_FILTER,
  OWNERSHIP_ACTION,
  OWNERSHIP_BODY_LARGE,
  OWNERSHIP_BODY_JSON,
  OWNERSHIP_BODY_INVALID,
]);

export type OwnershipQueueFilter = "contested" | "expired";

export interface OwnershipQueueRow {
  id: string;
  show_name: string;
  method: string | null;
  status: string;
  target: string | null;
  requester_email: string | null;
  miss_count: number;
  last_checked_at: string | null;
  created_at: string;
  note: string | null;
  exclusive_rep: boolean;
  rep_label: string | null;
}

export interface OwnershipOtherProof {
  status: string;
  method: string | null;
  created_at: string;
  decided_at: string | null;
  decided_by_email: string | null;
}

export interface OwnershipRepLink {
  rep_label: string;
  status: string;
  is_exclusive: boolean;
}

export interface OwnershipDetail {
  proof: OwnershipQueueRow & {
    rss_url: string | null;
    youtube_channel_id: string | null;
    ownership_status: string | null;
    decision_note: string | null;
    decided_at: string | null;
  };
  other_proofs: OwnershipOtherProof[];
  rep_links: OwnershipRepLink[];
}

type Fail = { ok: false; status: number; error: string };
type DbError = { code?: string; message?: string };

interface ProofRecord {
  id: string;
  show_id: string;
  user_id: string;
  method: string | null;
  status: string;
  target: string | null;
  miss_count: number;
  last_checked_at: string | null;
  created_at: string;
  note: string | null;
  decision_note: string | null;
  decided_at: string | null;
  decided_by: string | null;
}

export function ownershipManualRules(userId: string): RateLimitRule[] {
  return [
    {
      bucket: "ownership_manual_user_day",
      key: userId,
      max: OWNERSHIP_MANUAL_DAY_MAX,
      windowSeconds: OWNERSHIP_MANUAL_DAY_WINDOW_SEC,
    },
  ];
}

export function adminOwnershipReadRules(userId: string): RateLimitRule[] {
  return [
    {
      bucket: "admin_ownership_read_minute",
      key: userId,
      max: ADMIN_OWNERSHIP_READ_MAX,
      windowSeconds: ADMIN_OWNERSHIP_READ_WINDOW_SEC,
    },
  ];
}

export function adminOwnershipDecideRules(userId: string): RateLimitRule[] {
  return [
    {
      bucket: "admin_ownership_decide_minute",
      key: userId,
      max: ADMIN_OWNERSHIP_DECIDE_MAX,
      windowSeconds: ADMIN_OWNERSHIP_DECIDE_WINDOW_SEC,
    },
  ];
}

export function ownershipJson(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function ownershipNoStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function ownershipClientError(status: number, error: string, fallback: string): NextResponse {
  const safe = REVIEW_ERROR_TEXT.has(error) ? error : fallback;
  return ownershipJson({ error: safe }, status);
}

export function ownershipPublicError(error: string, fallback: string): string {
  return REVIEW_ERROR_TEXT.has(error) ? error : fallback;
}

export function parseOwnershipQueueStatus(
  value: string | null | undefined
): { ok: true; status: OwnershipQueueFilter | null } | { ok: false; error: string } {
  if (value == null || value === "" || value === "all") return { ok: true, status: null };
  if (value === "contested" || value === "expired") return { ok: true, status: value };
  return { ok: false, error: OWNERSHIP_STATUS_FILTER };
}

export async function readOwnershipBody(
  request: Request
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; status: 400 | 413 | 415; error: string }> {
  const declared = request.headers.get("content-length");
  if (declared != null && declared !== "") {
    if (!/^\d+$/.test(declared) || Number(declared) > BODY_MAX_BYTES) {
      return { ok: false, status: 413, error: OWNERSHIP_BODY_LARGE };
    }
  }
  const mime = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime !== "application/json") {
    return { ok: false, status: 415, error: OWNERSHIP_BODY_JSON };
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > BODY_MAX_BYTES) {
    return { ok: false, status: 413, error: OWNERSHIP_BODY_LARGE };
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
  } catch {
    return { ok: false, status: 400, error: OWNERSHIP_BODY_INVALID };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, status: 400, error: OWNERSHIP_BODY_INVALID };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

function logCode(tag: string, code: string | undefined): void {
  const safe = code && /^[A-Za-z0-9_]+$/.test(code) ? code : "unknown";
  console.error(tag, safe);
}

function needsMigration(error: DbError | null): boolean {
  if (!error) return false;
  if (error.code !== "42703" && error.code !== "PGRST204") return false;
  return (error.message ?? "").includes("decision_note");
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function charLength(value: string): number {
  return Array.from(value).length;
}

function caught(tag: string, fallback: string): Fail {
  logCode(tag, undefined);
  return { ok: false, status: 500, error: fallback };
}

async function assertDecisionColumn(tag: string, fallback: string): Promise<{ ok: true } | Fail> {
  const { error } = await supabaseAdmin.from("show_ownership_proofs").select("decision_note").limit(1);
  if (!error) return { ok: true };
  if (needsMigration(error)) return { ok: false, status: 503, error: OWNERSHIP_REVIEW_MIGRATION };
  logCode(tag, error.code);
  return { ok: false, status: 500, error: fallback };
}

function proofRecord(row: Record<string, unknown>): ProofRecord | null {
  const id = asText(row.id);
  const showId = asText(row.show_id);
  const userId = asText(row.user_id);
  if (!id || !showId || !userId) return null;
  return {
    id,
    show_id: showId,
    user_id: userId,
    method: asText(row.method),
    status: asText(row.status) ?? "",
    target: asText(row.target),
    miss_count: typeof row.miss_count === "number" ? row.miss_count : 0,
    last_checked_at: asText(row.last_checked_at),
    created_at: asText(row.created_at) ?? "",
    note: asText(row.note),
    decision_note: asText(row.decision_note),
    decided_at: asText(row.decided_at),
    decided_by: asText(row.decided_by),
  };
}

const PROOF_COLUMNS =
  "id, show_id, user_id, method, status, target, miss_count, last_checked_at, created_at, note, decision_note, decided_at, decided_by";

function statusesFor(filter: OwnershipQueueFilter | null): OwnershipQueueFilter[] {
  return filter ? [filter] : ["contested", "expired"];
}

function isNewerProof(row: ProofRecord, other: { id: string; created_at: string }): boolean {
  if (other.id === row.id) return false;
  const left = Date.parse(row.created_at);
  const right = Date.parse(other.created_at);
  if (Number.isNaN(left) || Number.isNaN(right)) return false;
  return right > left;
}

async function emailsFor(ids: string[], tag: string): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  const entries = await Promise.all(
    unique.map(async (id) => {
      try {
        return [id, await getAuthEmail(id)] as const;
      } catch {
        logCode(tag, undefined);
        return [id, null] as const;
      }
    })
  );
  return new Map(entries);
}

async function loadShows(
  ids: string[],
  tag: string
): Promise<{ ok: true; rows: Map<string, Record<string, unknown>> } | Fail> {
  const map = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return { ok: true, rows: map };
  const { data, error } = await supabaseAdmin
    .from("shows")
    .select("id, name, rss_url, youtube_channel_id, ownership_status")
    .in("id", ids);
  if (error) {
    logCode(tag, error.code);
    return { ok: false, status: 500, error: OWNERSHIP_LOAD_FAILED };
  }
  for (const row of data ?? []) {
    const id = asText((row as { id?: unknown }).id);
    if (id) map.set(id, row as Record<string, unknown>);
  }
  return { ok: true, rows: map };
}

async function loadExclusive(
  showIds: string[],
  tag: string
): Promise<{ ok: true; byShow: Map<string, string | null> } | Fail> {
  const byShow = new Map<string, string | null>();
  if (showIds.length === 0) return { ok: true, byShow };
  const { data, error } = await supabaseAdmin
    .from("agent_show_relationships")
    .select("show_id, agent_id")
    .in("show_id", showIds)
    .eq("status", "approved")
    .eq("is_exclusive", true);
  if (error) {
    logCode(tag, error.code);
    return { ok: false, status: 500, error: OWNERSHIP_LOAD_FAILED };
  }
  const agentIds = [...new Set((data ?? []).map((row) => asText(row.agent_id)).filter((id): id is string => Boolean(id)))];
  const labels = await profileLabels(agentIds, tag);
  if (!labels.ok) return labels;
  for (const row of data ?? []) {
    const showId = asText(row.show_id);
    const agentId = asText(row.agent_id);
    if (!showId || byShow.has(showId)) continue;
    byShow.set(showId, labels.labels.get(agentId ?? "") ?? rosterRepLabel(null));
  }
  return { ok: true, byShow };
}

async function profileLabels(
  agentIds: string[],
  tag: string
): Promise<{ ok: true; labels: Map<string, string> } | Fail> {
  const labels = new Map<string, string>();
  if (agentIds.length === 0) return { ok: true, labels };
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, company_name, full_name")
    .in("id", agentIds);
  if (error) {
    logCode(tag, error.code);
    return { ok: false, status: 500, error: OWNERSHIP_LOAD_FAILED };
  }
  for (const row of data ?? []) {
    const id = asText((row as { id?: unknown }).id);
    if (!id) continue;
    const profile = row as RepNameFields;
    labels.set(id, rosterRepLabel(profile));
  }
  return { ok: true, labels };
}

function queueRow(
  row: ProofRecord,
  showName: string,
  email: string | null,
  exclusive: { on: boolean; label: string | null }
): OwnershipQueueRow {
  return {
    id: row.id,
    show_name: showName,
    method: row.method,
    status: row.status,
    target: row.target,
    requester_email: email,
    miss_count: row.miss_count,
    last_checked_at: row.last_checked_at,
    created_at: row.created_at,
    note: row.note,
    exclusive_rep: exclusive.on,
    rep_label: exclusive.on ? exclusive.label : null,
  };
}

async function listInner(filter: OwnershipQueueFilter | null): Promise<{ ok: true; proofs: OwnershipQueueRow[] } | Fail> {
  const ready = await assertDecisionColumn(ADMIN_TAG, OWNERSHIP_LOAD_FAILED);
  if (!ready.ok) return ready;
  const { data, error } = await supabaseAdmin
    .from("show_ownership_proofs")
    .select(PROOF_COLUMNS)
    .in("status", statusesFor(filter))
    .order("created_at", { ascending: true })
    .limit(OWNERSHIP_QUEUE_SCAN);
  if (error) {
    if (needsMigration(error)) return { ok: false, status: 503, error: OWNERSHIP_REVIEW_MIGRATION };
    logCode(ADMIN_TAG, error.code);
    return { ok: false, status: 500, error: OWNERSHIP_LOAD_FAILED };
  }
  let rows = (data ?? [])
    .map((row) => proofRecord(row as Record<string, unknown>))
    .filter((row): row is ProofRecord => row !== null);
  const expired = rows.filter((row) => row.status === "expired");
  if (expired.length > 0) {
    const showIds = [...new Set(expired.map((row) => row.show_id))];
    const newer = await supabaseAdmin
      .from("show_ownership_proofs")
      .select("id, show_id, user_id, created_at")
      .in("show_id", showIds)
      .limit(5000);
    if (newer.error) {
      logCode(ADMIN_TAG, newer.error.code);
      return { ok: false, status: 500, error: OWNERSHIP_LOAD_FAILED };
    }
    const others = newer.data ?? [];
    rows = rows.filter((row) => {
      if (row.status !== "expired") return true;
      return !others.some((other) => {
        const showId = asText(other.show_id);
        const userId = asText(other.user_id);
        const id = asText(other.id);
        const created = asText(other.created_at);
        if (!showId || !userId || !id || !created) return false;
        return showId === row.show_id && userId === row.user_id && isNewerProof(row, { id, created_at: created });
      });
    });
  }
  rows.sort((a, b) => {
    if (a.created_at === b.created_at) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    return a.created_at < b.created_at ? -1 : 1;
  });
  rows = rows.slice(0, OWNERSHIP_QUEUE_LIMIT);
  const showIds = [...new Set(rows.map((row) => row.show_id))];
  const shows = await loadShows(showIds, ADMIN_TAG);
  if (!shows.ok) return shows;
  const exclusive = await loadExclusive(showIds, ADMIN_TAG);
  if (!exclusive.ok) return exclusive;
  const emails = await emailsFor(rows.map((row) => row.user_id), ADMIN_TAG);
  return {
    ok: true,
    proofs: rows.map((row) => {
      const show = shows.rows.get(row.show_id);
      const label = exclusive.byShow.get(row.show_id);
      return queueRow(row, asText(show?.name) ?? "", emails.get(row.user_id) ?? null, {
        on: exclusive.byShow.has(row.show_id),
        label: label ?? rosterRepLabel(null),
      });
    }),
  };
}

export async function listOwnershipQueue(input: {
  status: OwnershipQueueFilter | null;
}): Promise<{ ok: true; proofs: OwnershipQueueRow[] } | Fail> {
  try {
    return await listInner(input.status);
  } catch {
    return caught(ADMIN_TAG, OWNERSHIP_LOAD_FAILED);
  }
}

async function detailInner(id: string): Promise<{ ok: true; detail: OwnershipDetail } | Fail> {
  if (!isUuid(id)) return { ok: false, status: 400, error: OWNERSHIP_BAD_REQUEST };
  const ready = await assertDecisionColumn(ADMIN_TAG, OWNERSHIP_LOAD_FAILED);
  if (!ready.ok) return ready;
  const { data, error } = await supabaseAdmin
    .from("show_ownership_proofs")
    .select(PROOF_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (needsMigration(error)) return { ok: false, status: 503, error: OWNERSHIP_REVIEW_MIGRATION };
    logCode(ADMIN_TAG, error.code);
    return { ok: false, status: 500, error: OWNERSHIP_LOAD_FAILED };
  }
  const row = data ? proofRecord(data as Record<string, unknown>) : null;
  if (!row) return { ok: false, status: 404, error: OWNERSHIP_NOT_FOUND };
  const shows = await loadShows([row.show_id], ADMIN_TAG);
  if (!shows.ok) return shows;
  const show = shows.rows.get(row.show_id);
  const others = await supabaseAdmin
    .from("show_ownership_proofs")
    .select("id, status, method, created_at, decided_at, decided_by")
    .eq("show_id", row.show_id);
  if (others.error) {
    logCode(ADMIN_TAG, others.error.code);
    return { ok: false, status: 500, error: OWNERSHIP_LOAD_FAILED };
  }
  const links = await supabaseAdmin
    .from("agent_show_relationships")
    .select("agent_id, status, is_exclusive")
    .eq("show_id", row.show_id);
  if (links.error) {
    logCode(ADMIN_TAG, links.error.code);
    return { ok: false, status: 500, error: OWNERSHIP_LOAD_FAILED };
  }
  const linkRows = links.data ?? [];
  const agentIds = [...new Set(linkRows.map((link) => asText(link.agent_id)).filter((value): value is string => Boolean(value)))];
  const labels = await profileLabels(agentIds, ADMIN_TAG);
  if (!labels.ok) return labels;
  const otherRows = (others.data ?? []).filter((other) => asText(other.id) !== row.id);
  const emails = await emailsFor(
    [row.user_id, ...otherRows.map((other) => asText(other.decided_by) ?? "")],
    ADMIN_TAG
  );
  const exclusive = await loadExclusive([row.show_id], ADMIN_TAG);
  if (!exclusive.ok) return exclusive;
  const exclusiveLabel = exclusive.byShow.get(row.show_id);
  return {
    ok: true,
    detail: {
      proof: {
        ...queueRow(row, asText(show?.name) ?? "", emails.get(row.user_id) ?? null, {
          on: exclusive.byShow.has(row.show_id),
          label: exclusiveLabel ?? rosterRepLabel(null),
        }),
        rss_url: asText(show?.rss_url),
        youtube_channel_id: asText(show?.youtube_channel_id),
        ownership_status: asText(show?.ownership_status),
        decision_note: row.decision_note,
        decided_at: row.decided_at,
      },
      other_proofs: otherRows.map((other) => {
        const decidedBy = asText(other.decided_by);
        return {
          status: asText(other.status) ?? "",
          method: asText(other.method),
          created_at: asText(other.created_at) ?? "",
          decided_at: asText(other.decided_at),
          decided_by_email: decidedBy ? emails.get(decidedBy) ?? null : null,
        };
      }),
      rep_links: linkRows.map((link) => {
        const agentId = asText(link.agent_id);
        return {
          rep_label: (agentId && labels.labels.get(agentId)) || rosterRepLabel(null),
          status: asText(link.status) ?? "",
          is_exclusive: link.is_exclusive === true,
        };
      }),
    },
  };
}

export async function getOwnershipDetail(id: string): Promise<{ ok: true; detail: OwnershipDetail } | Fail> {
  try {
    return await detailInner(id);
  } catch {
    return caught(ADMIN_TAG, OWNERSHIP_LOAD_FAILED);
  }
}

async function approveInner(input: {
  proofId: string;
  adminId: string;
  now?: Date;
}): Promise<{ ok: true } | Fail> {
  if (!isUuid(input.proofId)) return { ok: false, status: 400, error: OWNERSHIP_BAD_REQUEST };
  const ready = await assertDecisionColumn(ADMIN_TAG, OWNERSHIP_APPROVE_FAILED);
  if (!ready.ok) return ready;
  const nowIso = (input.now ?? new Date()).toISOString();
  const updated = await supabaseAdmin
    .from("show_ownership_proofs")
    .update({
      status: "verified",
      decided_by: input.adminId,
      decided_at: nowIso,
      verified_at: nowIso,
      code_hash: null,
      updated_at: nowIso,
    })
    .eq("id", input.proofId)
    .in("status", ["contested", "expired"])
    .select("id, show_id");
  if (updated.error) {
    if (updated.error.code === "23505") {
      return { ok: false, status: 409, error: OWNERSHIP_ALREADY_VERIFIED };
    }
    if (needsMigration(updated.error)) return { ok: false, status: 503, error: OWNERSHIP_REVIEW_MIGRATION };
    logCode(ADMIN_TAG, updated.error.code);
    return { ok: false, status: 500, error: OWNERSHIP_APPROVE_FAILED };
  }
  const changed = (updated.data ?? [])[0] as { show_id?: unknown } | undefined;
  const showId = asText(changed?.show_id);
  if (!changed || !showId) {
    const prior = await supabaseAdmin
      .from("show_ownership_proofs")
      .select("show_id, status, decided_by")
      .eq("id", input.proofId)
      .maybeSingle();
    if (prior.error) {
      logCode(ADMIN_TAG, prior.error.code);
      return { ok: false, status: 500, error: OWNERSHIP_APPROVE_FAILED };
    }
    const priorShowId = asText(prior.data?.show_id);
    const priorStatus = asText(prior.data?.status);
    const decidedBy = asText(prior.data?.decided_by);
    if (priorStatus === "verified" && decidedBy && priorShowId) {
      return finishAdminVerify(priorShowId, input.adminId, nowIso);
    }
    return { ok: false, status: 409, error: OWNERSHIP_ALREADY_DECIDED };
  }
  return finishAdminVerify(showId, input.adminId, nowIso);
}

async function finishAdminVerify(showId: string, adminId: string, nowIso: string): Promise<{ ok: true } | Fail> {
  const show = await supabaseAdmin.from("shows").update({ ownership_status: "verified" }).eq("id", showId);
  if (show.error) {
    logCode(ADMIN_TAG, show.error.code);
    return { ok: false, status: 500, error: OWNERSHIP_APPROVE_FAILED };
  }
  const siblings = await supabaseAdmin
    .from("show_ownership_proofs")
    .update({
      status: "rejected",
      decision_note: OWNERSHIP_SIBLING_NOTE,
      decided_by: adminId,
      decided_at: nowIso,
      updated_at: nowIso,
    })
    .eq("show_id", showId)
    .in("status", ["pending", "contested", "expired"]);
  if (siblings.error) {
    if (needsMigration(siblings.error)) return { ok: false, status: 503, error: OWNERSHIP_REVIEW_MIGRATION };
    logCode(ADMIN_TAG, siblings.error.code);
    return { ok: false, status: 500, error: OWNERSHIP_APPROVE_FAILED };
  }
  try {
    await releaseHeldPayoutsForShow(showId);
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    logCode(ADMIN_TAG, /^[A-Za-z0-9_]+$/.test(name) ? name : "throw");
  }
  return { ok: true };
}

export async function approveOwnershipProof(input: {
  proofId: string;
  adminId: string;
  now?: Date;
}): Promise<{ ok: true } | Fail> {
  try {
    return await approveInner(input);
  } catch {
    return caught(ADMIN_TAG, OWNERSHIP_APPROVE_FAILED);
  }
}

async function rejectInner(input: {
  proofId: string;
  adminId: string;
  reason: unknown;
  now?: Date;
}): Promise<{ ok: true } | Fail> {
  if (!isUuid(input.proofId)) return { ok: false, status: 400, error: OWNERSHIP_BAD_REQUEST };
  const note = rosterReviewNote(input.reason);
  if (!note) return { ok: false, status: 400, error: OWNERSHIP_REASON_REQUIRED };
  const ready = await assertDecisionColumn(ADMIN_TAG, OWNERSHIP_REJECT_FAILED);
  if (!ready.ok) return ready;
  const nowIso = (input.now ?? new Date()).toISOString();
  const updated = await supabaseAdmin
    .from("show_ownership_proofs")
    .update({
      status: "rejected",
      decision_note: note,
      decided_by: input.adminId,
      decided_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", input.proofId)
    .in("status", ["contested", "expired"])
    .select("id");
  if (updated.error) {
    if (needsMigration(updated.error)) return { ok: false, status: 503, error: OWNERSHIP_REVIEW_MIGRATION };
    logCode(ADMIN_TAG, updated.error.code);
    return { ok: false, status: 500, error: OWNERSHIP_REJECT_FAILED };
  }
  if ((updated.data ?? []).length === 0) return { ok: false, status: 409, error: OWNERSHIP_ALREADY_DECIDED };
  return { ok: true };
}

export async function rejectOwnershipProof(input: {
  proofId: string;
  adminId: string;
  reason: unknown;
  now?: Date;
}): Promise<{ ok: true } | Fail> {
  try {
    return await rejectInner(input);
  } catch {
    return caught(ADMIN_TAG, OWNERSHIP_REJECT_FAILED);
  }
}

function explanationOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const length = charLength(text);
  if (length < EXPLANATION_MIN || length > EXPLANATION_MAX) return null;
  return text;
}

function linkOf(value: unknown): { ok: true; link: string | null } | { ok: false } {
  if (value == null || value === "") return { ok: true, link: null };
  if (typeof value !== "string") return { ok: false };
  const text = value.trim();
  if (!text) return { ok: true, link: null };
  if (charLength(text) > LINK_MAX) return { ok: false };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "https:") return { ok: false };
  return { ok: true, link: text };
}

function manualNote(explanation: string, link: string | null): string {
  const base = `Manual review: ${explanation}`;
  return link ? `${base} Link: ${link}` : base;
}

async function manualInner(input: {
  userId: string;
  showProfileId: string;
  medium: unknown;
  explanation: unknown;
  link?: unknown;
  channel?: unknown;
}): Promise<{ ok: true; message: string } | Fail> {
  if (input.medium !== "podcast" && input.medium !== "youtube") {
    return { ok: false, status: 400, error: OWNERSHIP_ERRORS.medium };
  }
  const explanation = explanationOf(input.explanation);
  if (!explanation) return { ok: false, status: 400, error: OWNERSHIP_EXPLANATION_ERROR };
  const link = linkOf(input.link);
  if (!link.ok) return { ok: false, status: 400, error: OWNERSHIP_LINK_ERROR };
  const ready = await assertDecisionColumn(MANUAL_TAG, OWNERSHIP_ERRORS.unavailable);
  if (!ready.ok) return ready;
  const medium = input.medium as OwnershipMedium;
  let target = "";
  if (medium === "podcast") {
    const profile = await supabaseAdmin
      .from("show_profiles")
      .select("feed_url")
      .eq("id", input.showProfileId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (profile.error) {
      logCode(MANUAL_TAG, profile.error.code);
      return { ok: false, status: 503, error: OWNERSHIP_ERRORS.unavailable };
    }
    const feed = typeof profile.data?.feed_url === "string" ? profile.data.feed_url.trim() : "";
    if (!feed) return { ok: false, status: 400, error: OWNERSHIP_ERRORS.noFeed };
    target = normalizeRssUrl(feed);
    if (!target) return { ok: false, status: 400, error: OWNERSHIP_ERRORS.noFeed };
  } else {
    const channelId = parseYoutubeChannelTarget(typeof input.channel === "string" ? input.channel : "");
    if (!channelId) return { ok: false, status: 400, error: OWNERSHIP_ERRORS.channel };
    target = channelId;
  }
  const shows = await matchingShowIds(medium, target);
  if (!shows.ok) {
    logCode(MANUAL_TAG, shows.error.code);
    return { ok: false, status: 503, error: OWNERSHIP_ERRORS.unavailable };
  }
  if (shows.ids.length === 0) return { ok: false, status: 409, error: OWNERSHIP_ERRORS.noCatalog };
  const existing = await supabaseAdmin
    .from("show_ownership_proofs")
    .select("show_id, decision_note")
    .eq("user_id", input.userId)
    .eq("status", "contested")
    .in("show_id", shows.ids);
  if (existing.error) {
    if (needsMigration(existing.error)) return { ok: false, status: 503, error: OWNERSHIP_REVIEW_MIGRATION };
    logCode(MANUAL_TAG, existing.error.code);
    return { ok: false, status: 503, error: OWNERSHIP_ERRORS.unavailable };
  }
  if ((existing.data ?? []).length > 0) return { ok: false, status: 409, error: OWNERSHIP_DUPLICATE };
  const note = manualNote(explanation, link.link);
  const inserted = await supabaseAdmin.from("show_ownership_proofs").insert(
    shows.ids.map((showId) => ({
      show_id: showId,
      user_id: input.userId,
      show_profile_id: input.showProfileId,
      method: "admin",
      status: "contested",
      target,
      note,
      check_count: 0,
      miss_count: 0,
    }))
  );
  if (inserted.error) {
    if (needsMigration(inserted.error)) return { ok: false, status: 503, error: OWNERSHIP_REVIEW_MIGRATION };
    logCode(MANUAL_TAG, inserted.error.code);
    return { ok: false, status: 503, error: OWNERSHIP_ERRORS.unavailable };
  }
  return { ok: true, message: OWNERSHIP_MESSAGES.review };
}

export async function requestManualOwnership(input: {
  userId: string;
  showProfileId: string;
  medium: unknown;
  explanation: unknown;
  link?: unknown;
  channel?: unknown;
}): Promise<{ ok: true; message: string } | Fail> {
  try {
    return await manualInner(input);
  } catch {
    return caught(MANUAL_TAG, OWNERSHIP_ERRORS.unavailable);
  }
}
