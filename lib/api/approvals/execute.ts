// Turn an approved campaign.create action into one draft campaign.
// The claim is a conditional update, so two retries cannot both
// create a row. Outreach is not executed here.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { createCampaign } from "@/lib/data/queries";
import { getCampaignPatternById } from "@/lib/data/reasoning-log";
import { logEvent } from "@/lib/data/events";
import { ApiWriteError } from "@/lib/api/v1/handler";
import {
  validateCampaignCreate,
  type CampaignCreatePayload,
} from "@/lib/api/v1/writes";
import type { CampaignPatternRow } from "@/lib/data/types";
import { isUuid } from "@/lib/api/v1/pagination";
import { quoteFilterValue } from "@/lib/api/approvals/list";

export const EXECUTION_ERROR = "The campaign could not be created.";
const CLAIM_STALE_MS = 5 * 60 * 1000;

export type ExecuteResult =
  | { ok: true; campaignId: string }
  | { ok: false; reason: "failed" | "busy" };

export async function executeApprovedCampaign(input: {
  userId: string;
  actionId: string;
}): Promise<ExecuteResult> {
  if (!isUuid(input.userId) || !isUuid(input.actionId)) {
    return { ok: false, reason: "failed" };
  }
  const claimed = await claim(input.userId, input.actionId);
  if (claimed.status === "busy") return { ok: false, reason: "busy" };
  if (claimed.status === "done") return { ok: true, campaignId: claimed.campaignId };
  if (claimed.status !== "claimed") return { ok: false, reason: "failed" };

  try {
    const payload = validateCampaignCreate(claimed.payload);
    const existingDraft = await findDraftForAction(input.userId, input.actionId);
    if (existingDraft.error) {
      await failExecution(input.userId, input.actionId);
      return { ok: false, reason: "failed" };
    }
    if (existingDraft.campaignId) {
      return finishExisting(input.userId, input.actionId, existingDraft.campaignId, payload);
    }
    const pattern = await ownedPattern(input.userId, payload);
    if (payload.customer_context?.reused_from_pattern_id && !pattern) {
      await failExecution(input.userId, input.actionId);
      return { ok: false, reason: "failed" };
    }
    const campaign = await createCampaign({
      user_id: input.userId,
      name: campaignName(payload, pattern),
      brief: briefFromPayload(payload, input.actionId),
      budget_total: payload.budget_total,
      platforms: ["podcast", "youtube"],
      status: "draft",
      recommendations: [],
    });
    if (!campaign) {
      await failExecution(input.userId, input.actionId);
      return { ok: false, reason: "failed" };
    }
    return finishExisting(input.userId, input.actionId, campaign.id, payload);
  } catch (err) {
    if (!(err instanceof ApiWriteError)) {
      console.error("[approvals.execute] campaign create failed");
    }
    await failExecution(input.userId, input.actionId);
    return { ok: false, reason: "failed" };
  }
}

/** Same shape as the manual brief name, with " - " in place of the em dash. */
export function campaignName(
  payload: CampaignCreatePayload,
  pattern: CampaignPatternRow | null,
  now = new Date()
): string {
  let brandName = payload.product?.brand_name?.trim();
  if (!brandName && pattern) {
    const fromPattern = pattern.product_attributes?.brand_name;
    if (typeof fromPattern === "string" && fromPattern.trim()) {
      brandName = fromPattern.trim();
    }
  }
  const monthYear = now.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  return `${brandName || "Campaign"} - ${monthYear}`;
}

function briefFromPayload(
  payload: CampaignCreatePayload,
  actionId: string
): Record<string, unknown> {
  return {
    version: 2,
    product: payload.product,
    customer_text: payload.customer_text,
    customer_context: payload.customer_context,
    goals: payload.goals,
    goals_context: payload.goals_context,
    flight: payload.flight,
    exclusions_text: payload.exclusions_text,
    source_action_id: actionId,
    submitted_at: new Date().toISOString(),
  };
}

async function findDraftForAction(
  userId: string,
  actionId: string
): Promise<{ campaignId: string | null; error: boolean }> {
  try {
    const { data, error } = await supabaseAdmin
      .from("campaigns")
      .select("id")
      .eq("user_id", userId)
      .eq("brief->>source_action_id", actionId)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[approvals.execute] draft lookup failed", error.code ?? "unknown");
      return { campaignId: null, error: true };
    }
    if (!data) return { campaignId: null, error: false };
    const id = (data as { id?: unknown }).id;
    return {
      campaignId: typeof id === "string" && isUuid(id) ? id : null,
      error: false,
    };
  } catch {
    console.error("[approvals.execute] draft lookup failed");
    return { campaignId: null, error: true };
  }
}

async function finishExisting(
  userId: string,
  actionId: string,
  campaignId: string,
  payload: CampaignCreatePayload
): Promise<ExecuteResult> {
  const linked = await linkCampaign(userId, actionId, campaignId);
  if (!linked) {
    const existing = await readResult(userId, actionId);
    if (existing) return { ok: true, campaignId: existing };
    await markExecutionError(userId, actionId, false);
    await logFailed(userId, actionId);
    return { ok: false, reason: "failed" };
  }
  await logEvent({
    eventType: "brief.submitted",
    entityType: "campaign",
    entityId: campaignId,
    actorId: userId,
    payload: {
      reused_from_pattern_id: payload.customer_context?.reused_from_pattern_id ?? null,
      changed_fields: Object.keys(payload.customer_context?.changed_fields ?? {}),
      goals: payload.goals ?? [],
      budget_total: payload.budget_total ?? null,
      source: "api_action",
      action_id: actionId,
    },
  });
  await logEvent({
    eventType: "api_action.executed",
    entityType: "api_action",
    entityId: actionId,
    actorId: userId,
    payload: { action_id: actionId, kind: "campaign.create" },
  });
  return { ok: true, campaignId };
}

async function ownedPattern(
  userId: string,
  payload: CampaignCreatePayload
): Promise<CampaignPatternRow | null> {
  const patternId = payload.customer_context?.reused_from_pattern_id;
  if (!patternId) return null;
  const pattern = await getCampaignPatternById(patternId);
  if (!pattern || pattern.customer_id?.toLowerCase() !== userId.toLowerCase()) return null;
  return pattern;
}

type Claim =
  | { status: "claimed"; payload: unknown }
  | { status: "done"; campaignId: string }
  | { status: "busy" }
  | { status: "missing" };

async function claim(userId: string, actionId: string): Promise<Claim> {
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("api_write_actions")
    .update({ execution_started_at: new Date().toISOString() })
    .eq("id", actionId)
    .eq("brand_id", userId)
    .eq("status", "approved")
    .eq("kind", "campaign.create")
    .is("result_campaign_id", null)
    .is("executed_at", null)
    .or(`execution_started_at.is.null,execution_started_at.lt.${quoteFilterValue(staleBefore)}`)
    .select("id, payload, result_campaign_id")
    .maybeSingle();
  if (error) {
    console.error("[approvals.execute] claim failed", error.code ?? "unknown");
    return { status: "missing" };
  }
  if (data) return { status: "claimed", payload: (data as { payload?: unknown }).payload };
  const existing = await readResult(userId, actionId);
  if (existing) return { status: "done", campaignId: existing };
  const held = await claimIsFresh(userId, actionId);
  if (held) return { status: "busy" };
  return { status: "missing" };
}

async function claimIsFresh(userId: string, actionId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("api_write_actions")
    .select("execution_started_at, result_campaign_id, status")
    .eq("id", actionId)
    .eq("brand_id", userId)
    .maybeSingle();
  if (!data) return false;
  const row = data as {
    execution_started_at?: string | null;
    result_campaign_id?: string | null;
    status?: string;
  };
  if (row.result_campaign_id || row.status !== "approved" || !row.execution_started_at) return false;
  const started = Date.parse(row.execution_started_at);
  return Number.isFinite(started) && Date.now() - started < CLAIM_STALE_MS;
}

async function readResult(userId: string, actionId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("api_write_actions")
    .select("result_campaign_id")
    .eq("id", actionId)
    .eq("brand_id", userId)
    .maybeSingle();
  const id = (data as { result_campaign_id?: string | null } | null)?.result_campaign_id;
  return typeof id === "string" && isUuid(id) ? id : null;
}

async function linkCampaign(userId: string, actionId: string, campaignId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("api_write_actions")
    .update({
      result_campaign_id: campaignId,
      executed_at: new Date().toISOString(),
      execution_error: null,
    })
    .eq("id", actionId)
    .eq("brand_id", userId)
    .is("result_campaign_id", null)
    .select("result_campaign_id")
    .maybeSingle();
  if (error) {
    console.error("[approvals.execute] link failed", error.code ?? "unknown");
    return false;
  }
  return (data as { result_campaign_id?: string } | null)?.result_campaign_id === campaignId;
}

async function failExecution(userId: string, actionId: string): Promise<void> {
  await markExecutionError(userId, actionId, true);
  await logFailed(userId, actionId);
}

async function markExecutionError(
  userId: string,
  actionId: string,
  releaseClaim: boolean
): Promise<void> {
  const patch: { execution_error: string; execution_started_at?: null } = {
    execution_error: EXECUTION_ERROR,
  };
  if (releaseClaim) patch.execution_started_at = null;
  const { error } = await supabaseAdmin
    .from("api_write_actions")
    .update(patch)
    .eq("id", actionId)
    .eq("brand_id", userId)
    .eq("status", "approved")
    .is("result_campaign_id", null)
    .is("executed_at", null);
  if (error) console.error("[approvals.execute] error write failed", error.code ?? "unknown");
}

async function logFailed(userId: string, actionId: string): Promise<void> {
  await logEvent({
    eventType: "api_action.execution_failed",
    entityType: "api_action",
    entityId: actionId,
    actorId: userId,
    payload: { action_id: actionId, kind: "campaign.create" },
  });
}
