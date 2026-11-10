// Approve, reject, or retry one api_write_actions row for the
// session brand. The decision update matches status pending and a
// created_at inside 14 days, so two approvals cannot both win.
// Approving outreach.draft records the decision and sends nothing.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/data/events";
import { getShow } from "@/lib/api/v1/reads";
import { ApiReadError } from "@/lib/api/v1/handler";
import { isUuid } from "@/lib/api/v1/pagination";
import type { RateLimitRule } from "@/lib/security/rate-limit";
import type { ActionKind, ActionStatus } from "@/lib/api/v1/writes";
import {
  getBrandAction,
  isPendingExpired,
  pendingCutoff,
  type ListedAction,
} from "@/lib/api/approvals/list";
import { EXECUTION_ERROR, executeApprovedCampaign } from "@/lib/api/approvals/execute";

export const API_ACTION_DECIDE_BUCKET = "api_action_decide_user_hour";
export const API_ACTION_DECIDE_MAX = 60;
export const API_ACTION_DECIDE_WINDOW_SEC = 60 * 60;

const SHOW_UNAVAILABLE = "This show is no longer available.";
const DECISION_KEYS = ["decision", "note"];

export type ActionDecision = "approve" | "reject" | "retry";

export function apiActionDecideRule(userId: string): RateLimitRule {
  return {
    bucket: API_ACTION_DECIDE_BUCKET,
    key: userId,
    max: API_ACTION_DECIDE_MAX,
    windowSeconds: API_ACTION_DECIDE_WINDOW_SEC,
  };
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let originHost = "";
  try {
    const url = new URL(origin);
    if (url.username || url.password) return false;
    originHost = url.host.toLowerCase();
  } catch {
    return false;
  }
  const requestHost = (request.headers.get("host") ?? safeHost(request.url)).toLowerCase();
  return originHost.length > 0 && originHost === requestHost;
}

export function parseDecisionBody(
  body: unknown
): { ok: true; decision: ActionDecision; note: string | null } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Request body must be an object." };
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!DECISION_KEYS.includes(key)) return { ok: false, error: `Unknown field ${key}.` };
  }
  const decision = record.decision;
  if (decision !== "approve" && decision !== "reject" && decision !== "retry") {
    return { ok: false, error: "decision must be approve, reject, or retry." };
  }
  if (!Object.prototype.hasOwnProperty.call(record, "note")) {
    return { ok: true, decision, note: null };
  }
  if (typeof record.note !== "string") return { ok: false, error: "note must be text." };
  const note = record.note.trim();
  if (note.length > 500) return { ok: false, error: "note is too long." };
  if (/[\u0000-\u001F\u007F]/.test(note)) {
    return { ok: false, error: "note must be printable text." };
  }
  return { ok: true, decision, note: note.length === 0 ? null : note };
}

export type DecideResult =
  | { ok: true; httpStatus: 200; action: ListedAction; message: string }
  | {
      ok: false;
      httpStatus: number;
      error: string;
      status?: ActionStatus;
      action?: ListedAction;
    };

interface OwnedRow {
  id: string;
  kind: string;
  status: string;
  payload: unknown;
  created_at: string;
  result_campaign_id: string | null;
  executed_at: string | null;
}

export async function decideAction(input: {
  userId: string;
  actionId: string;
  decision: ActionDecision;
  note: string | null;
}): Promise<DecideResult> {
  if (!isUuid(input.userId) || !isUuid(input.actionId)) {
    return { ok: false, httpStatus: 404, error: "Not found." };
  }
  if (input.decision === "retry") return retryAction(input.userId, input.actionId);

  const existing = await readOwned(input.userId, input.actionId);
  if (!existing) return { ok: false, httpStatus: 404, error: "Not found." };
  if (existing.status !== "pending") {
    return conflict(existing.status);
  }
  if (isPendingExpired(existing.created_at)) {
    await markExpired(input.userId, input.actionId);
    return {
      ok: false,
      httpStatus: 409,
      error: "This action has expired.",
      status: "expired",
    };
  }
  if (input.decision === "approve" && existing.kind === "outreach.draft") {
    const visible = await outreachShowCheck(input.userId, existing.payload);
    if (visible === "error") {
      return { ok: false, httpStatus: 500, error: "Could not check the show." };
    }
    if (visible !== "visible") {
      return { ok: false, httpStatus: 409, error: SHOW_UNAVAILABLE };
    }
  }

  const decidedAt = new Date().toISOString();
  const status = input.decision === "approve" ? "approved" : "rejected";
  const { data, error } = await supabaseAdmin
    .from("api_write_actions")
    .update({
      status,
      decided_by: input.userId,
      decided_at: decidedAt,
      decision_note: input.note,
    })
    .eq("id", input.actionId)
    .eq("brand_id", input.userId)
    .eq("status", "pending")
    .gte("created_at", pendingCutoff())
    .select("id, kind, status")
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    console.error("[approvals.decide] update failed", error.code ?? "unknown");
    return { ok: false, httpStatus: 500, error: "Could not save the decision." };
  }
  if (!data) return lostDecision(input.userId, input.actionId);

  const kind = (data as { kind?: string }).kind === "outreach.draft" ? "outreach.draft" : "campaign.create";
  await logDecision(input.userId, input.actionId, kind, status);

  if (status === "approved" && kind === "campaign.create") {
    const executed = await executeApprovedCampaign({
      userId: input.userId,
      actionId: input.actionId,
    });
    const action = await getBrandAction(input.userId, input.actionId);
    if (!executed.ok) {
      if (executed.reason === "busy") {
        return {
          ok: false,
          httpStatus: 409,
          error: "This action is already running.",
          status: "approved",
          action: action ?? undefined,
        };
      }
      return {
        ok: false,
        httpStatus: 502,
        error: EXECUTION_ERROR,
        status: "approved",
        action: action ?? undefined,
      };
    }
    const ready = action ?? (await getBrandAction(input.userId, input.actionId));
    if (!ready) return { ok: false, httpStatus: 500, error: "Could not save the decision." };
    return { ok: true, httpStatus: 200, action: ready, message: "Approved." };
  }

  const action = await getBrandAction(input.userId, input.actionId);
  if (!action) return { ok: false, httpStatus: 500, error: "Could not save the decision." };
  const message =
    status === "approved" ? "Approved. Nothing was sent." : "Rejected.";
  return { ok: true, httpStatus: 200, action, message };
}

async function retryAction(userId: string, actionId: string): Promise<DecideResult> {
  const existing = await readOwned(userId, actionId);
  if (!existing) return { ok: false, httpStatus: 404, error: "Not found." };
  if (
    existing.status !== "approved" ||
    existing.kind !== "campaign.create" ||
    existing.result_campaign_id ||
    existing.executed_at
  ) {
    return {
      ok: false,
      httpStatus: 409,
      error: "Retry is only available for a campaign brief that has not been created.",
      status: isActionStatus(existing.status) ? existing.status : undefined,
    };
  }
  const executed = await executeApprovedCampaign({ userId, actionId });
  const action = await getBrandAction(userId, actionId);
  if (!executed.ok) {
    if (executed.reason === "busy") {
      return {
        ok: false,
        httpStatus: 409,
        error: "This action is already running.",
        status: "approved",
        action: action ?? undefined,
      };
    }
    return {
      ok: false,
      httpStatus: 502,
      error: EXECUTION_ERROR,
      status: "approved",
      action: action ?? undefined,
    };
  }
  if (!action) return { ok: false, httpStatus: 500, error: "Could not save the decision." };
  return { ok: true, httpStatus: 200, action, message: "Approved." };
}

async function lostDecision(userId: string, actionId: string): Promise<DecideResult> {
  const again = await readOwned(userId, actionId);
  if (!again) return { ok: false, httpStatus: 404, error: "Not found." };
  if (again.status === "pending" && isPendingExpired(again.created_at)) {
    await markExpired(userId, actionId);
    return {
      ok: false,
      httpStatus: 409,
      error: "This action has expired.",
      status: "expired",
    };
  }
  return conflict(again.status);
}

function conflict(status: string): DecideResult {
  const current = isActionStatus(status) ? status : "pending";
  const error =
    current === "expired" ? "This action has expired." : "This action is already decided.";
  return { ok: false, httpStatus: 409, error, status: current };
}

async function outreachShowCheck(
  userId: string,
  payload: unknown
): Promise<"visible" | "gone" | "error"> {
  const showId =
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    typeof (payload as { show_id?: unknown }).show_id === "string"
      ? (payload as { show_id: string }).show_id
      : "";
  if (!isUuid(showId)) return "gone";
  try {
    await getShow(userId, showId);
    return "visible";
  } catch (err) {
    if (err instanceof ApiReadError) return "gone";
    console.error("[approvals.decide] show check failed");
    return "error";
  }
}

async function readOwned(userId: string, actionId: string): Promise<OwnedRow | null> {
  const { data, error } = await supabaseAdmin
    .from("api_write_actions")
    .select("id, kind, status, payload, created_at, result_campaign_id, executed_at")
    .eq("brand_id", userId)
    .eq("id", actionId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  if (typeof row.id !== "string") return null;
  return {
    id: row.id,
    kind: typeof row.kind === "string" ? row.kind : "",
    status: typeof row.status === "string" ? row.status : "",
    payload: row.payload ?? null,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    result_campaign_id:
      typeof row.result_campaign_id === "string" ? row.result_campaign_id : null,
    executed_at: typeof row.executed_at === "string" ? row.executed_at : null,
  };
}

async function markExpired(userId: string, actionId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("api_write_actions")
    .update({ status: "expired" })
    .eq("id", actionId)
    .eq("brand_id", userId)
    .eq("status", "pending")
    .lt("created_at", pendingCutoff());
  if (error) console.error("[approvals.decide] expire failed", error.code ?? "unknown");
}

async function logDecision(
  userId: string,
  actionId: string,
  kind: ActionKind,
  status: "approved" | "rejected"
): Promise<void> {
  await logEvent({
    eventType: status === "approved" ? "api_action.approved" : "api_action.rejected",
    entityType: "api_action",
    entityId: actionId,
    actorId: userId,
    payload: { action_id: actionId, kind },
  });
}

function isActionStatus(value: string): value is ActionStatus {
  return value === "pending" || value === "approved" || value === "rejected" || value === "expired";
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
