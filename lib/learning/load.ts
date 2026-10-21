// Server loader for the learning review. Show identity is deals.show_id
// joined to shows.id. show_profiles is not read.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { isInternalAdmin } from "@/lib/auth/admin";
import {
  getAuthenticatedUser,
  getCampaignById,
  getUserProfile,
} from "@/lib/data/queries";
import { getLatestCampaignPatternForCampaign } from "@/lib/data/reasoning-log";
import type { Campaign, UserRole } from "@/lib/data/types";
import {
  assembleLearningInput,
  type AssembleLearningInput,
  type RawAircheck,
  type RawDeal,
  type RawIo,
  type RawLine,
  type RawOverride,
  type RawOutreach,
  type RawReport,
  type RawRing,
  type RawScore,
  type RawShowName,
} from "./assemble";
import type { LearningReviewInput } from "./review";

const CHUNK = 80;

interface DealRow extends RawDeal {
  agent_id?: string | null;
}

export class LearningLoadError extends Error {}

export interface LearningBundle {
  input: LearningReviewInput;
  allowedShowIds: string[];
  allowedRingIds: string[];
  /** Deal id → status, for the conversion write check. */
  dealStatus: Record<string, string>;
}

export interface LearningPageAccess {
  campaign: Campaign;
  isBrandOwner: boolean;
  isAdmin: boolean;
  role: UserRole | null;
  representedShowIds: string[];
  bundle: LearningBundle;
}

type AuthUser = { id: string; email?: string | null };

export async function resolveLearningPage(
  user: AuthUser,
  campaignId: string
): Promise<LearningPageAccess | null> {
  const [profile, visible] = await Promise.all([
    getUserProfile(user.id),
    getCampaignById(campaignId),
  ]);
  const isAdmin = isInternalAdmin(user.email);
  const role = profile?.role ?? null;
  const owned = visible && visible.user_id === user.id ? visible : null;

  let campaign = owned;
  if (!campaign && (isAdmin || role === "agent")) {
    campaign = await getCampaignAdmin(campaignId);
  }
  if (!campaign) return null;

  const bundle = await loadLearningBundle(campaign);
  const representedShowIds =
    isAdmin || role === "agent"
      ? await loadRepresentedShowIds(user.id, bundle.allowedShowIds, campaignId)
      : [];

  const isBrandOwner = campaign.user_id === user.id;
  if (!isBrandOwner && !isAdmin && representedShowIds.length === 0) return null;

  return {
    campaign,
    isBrandOwner,
    isAdmin,
    role,
    representedShowIds,
    bundle,
  };
}

/** Route helper. Separates a signed-out caller from a campaign they can't see. */
export async function resolveLearningPageForRequest(
  campaignId: string
): Promise<
  | { status: "unauthenticated" }
  | { status: "not_found" }
  | { status: "ok"; userId: string; access: LearningPageAccess }
> {
  const user = await getAuthenticatedUser();
  if (!user) return { status: "unauthenticated" };
  const access = await resolveLearningPage(user, campaignId);
  if (!access) return { status: "not_found" };
  return { status: "ok", userId: user.id, access };
}

export async function loadLearningBundle(campaign: Campaign): Promise<LearningBundle> {
  const raw = await loadRaw(campaign);
  const input = assembleLearningInput(raw);
  const allowedShowIds = [
    ...new Set(
      [
        ...raw.deals.map((deal) => deal.show_id),
        ...raw.scores.map((score) => score.show_id),
      ].filter((id): id is string => !!id)
    ),
  ];
  const dealStatus: Record<string, string> = {};
  for (const deal of raw.deals) {
    if (deal.id) dealStatus[deal.id] = deal.status ?? "";
  }
  return {
    input,
    allowedShowIds,
    allowedRingIds: raw.rings.map((ring) => ring.id),
    dealStatus,
  };
}

async function loadRaw(campaign: Campaign): Promise<AssembleLearningInput> {
  const { data: outreachRows, error: outreachError } = await supabaseAdmin
    .from("outreaches")
    .select("id, show_name")
    .eq("campaign_id", campaign.id);
  if (outreachError) {
    throw new LearningLoadError(outreachError.message);
  }
  const outreaches = (outreachRows ?? []) as RawOutreach[];
  const outreachIds = outreaches.map((row) => row.id);

  const byOutreach = outreachIds.length
    ? await selectIn<DealRow>(
        "deals",
        "outreach_id",
        outreachIds,
        "id, show_id, campaign_id, outreach_id, status, promo_code, reader_type, placement, agreed_placement, agent_id"
      )
    : [];
  const { data: legacyRows, error: legacyError } = await supabaseAdmin
    .from("deals")
    .select(
      "id, show_id, campaign_id, outreach_id, status, promo_code, reader_type, placement, agreed_placement, agent_id"
    )
    .eq("campaign_id", campaign.id);
  if (legacyError) throw new LearningLoadError(legacyError.message);

  const deals = dedupeDeals([
    ...byOutreach,
    ...((legacyRows ?? []) as DealRow[]),
  ]);
  const dealIds = deals.map((deal) => deal.id);

  const ios = await selectIn<RawIo>(
    "insertion_orders",
    "deal_id",
    dealIds,
    "id, deal_id"
  );
  const lines = await selectIn<RawLine>(
    "io_line_items",
    "io_id",
    ios.map((io) => io.id),
    "id, io_id, placement, reader_type, spot_format, verified"
  );

  const lineIds = lines.map((line) => line.id);
  // match_evidence is migration 039 (applied). review_decision is migration
  // 040 (not applied yet). Ask for them separately so a missing decision
  // column does not drop the code/URL check.
  const airchecks = await selectInOptional<RawAircheck>(
    "airchecks",
    "io_line_item_id",
    lineIds,
    "io_line_item_id, match_evidence"
  );
  const decisions = await selectInOptional<{
    io_line_item_id: string;
    review_decision: string | null;
  }>("airchecks", "io_line_item_id", lineIds, "io_line_item_id, review_decision");
  const decisionByLine = new Map(
    decisions.map((row) => [row.io_line_item_id, row.review_decision ?? null])
  );
  for (const aircheck of airchecks) {
    if (decisionByLine.has(aircheck.io_line_item_id)) {
      aircheck.review_decision = decisionByLine.get(aircheck.io_line_item_id) ?? null;
    }
  }

  const pattern = await getLatestCampaignPatternForCampaign(campaign.id);
  let rings: RawRing[] = [];
  let scores: RawScore[] = [];
  if (pattern) {
    const [ringRes, scoreRes] = await Promise.all([
      supabaseAdmin
        .from("ring_hypotheses")
        .select("id, label, brand_decision")
        .eq("campaign_pattern_id", pattern.id),
      supabaseAdmin
        .from("conviction_scores")
        .select("show_id, ring_hypothesis_id, composite_score, tier")
        .eq("campaign_pattern_id", pattern.id),
    ]);
    if (ringRes.error) {
      console.warn("[learning] rings unavailable:", ringRes.error.message);
    } else {
      rings = (ringRes.data ?? []) as RawRing[];
    }
    if (scoreRes.error) {
      console.warn("[learning] scores unavailable:", scoreRes.error.message);
    } else {
      scores = (scoreRes.data ?? []) as RawScore[];
    }
  }

  const showIds = [
    ...new Set(
      [
        ...deals.map((deal) => deal.show_id),
        ...scores.map((score) => score.show_id),
      ].filter((id): id is string => !!id)
    ),
  ];
  const shows = await selectIn<RawShowName>("shows", "id", showIds, "id, name");

  const reports = await selectInOptional<RawReport>(
    "deal_conversion_reports",
    "deal_id",
    dealIds,
    "deal_id, reported_conversions"
  );
  const overrides = await optionalCampaignOverrides(campaign.id);

  return {
    campaignStatus: campaign.status,
    brandWebsite: await loadBrandWebsite(campaign),
    deals,
    outreaches,
    shows,
    ios,
    lines,
    airchecks,
    scores,
    rings,
    reports,
    overrides,
  };
}

async function loadBrandWebsite(campaign: Campaign): Promise<string | null> {
  if (campaign.brand_profile_id) {
    const { data } = await supabaseAdmin
      .from("brand_profiles")
      .select("brand_website")
      .eq("id", campaign.brand_profile_id)
      .maybeSingle();
    const site = (data as { brand_website?: string | null } | null)?.brand_website;
    if (site?.trim()) return site;
  }
  const { data } = await supabaseAdmin
    .from("brand_profiles")
    .select("brand_website")
    .eq("user_id", campaign.user_id)
    .maybeSingle();
  return (data as { brand_website?: string | null } | null)?.brand_website ?? null;
}

async function loadRepresentedShowIds(
  userId: string,
  showIds: string[],
  campaignId: string
): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("agent_show_relationships")
    .select("show_id")
    .eq("agent_id", userId);
  if (error) {
    console.warn("[learning] rep relationships unavailable:", error.message);
    return [];
  }
  const related = new Set(
    ((data ?? []) as { show_id: string | null }[])
      .map((row) => row.show_id)
      .filter((id): id is string => !!id)
  );
  const represented = new Set<string>();
  for (const showId of showIds) {
    if (related.has(showId)) represented.add(showId);
  }

  const { data: agentDeals, error: dealError } = await supabaseAdmin
    .from("deals")
    .select("show_id, campaign_id, outreach_id")
    .eq("agent_id", userId);
  if (dealError || !agentDeals) return [...represented];

  const outreachIds = (agentDeals as { outreach_id?: string | null }[])
    .map((deal) => deal.outreach_id)
    .filter((id): id is string => !!id);
  const onCampaign = new Set<string>();
  if (outreachIds.length > 0) {
    const { data: linked } = await supabaseAdmin
      .from("outreaches")
      .select("id")
      .in("id", outreachIds)
      .eq("campaign_id", campaignId);
    for (const row of (linked ?? []) as { id: string }[]) onCampaign.add(row.id);
  }
  for (const deal of agentDeals as {
    show_id: string | null;
    campaign_id?: string | null;
    outreach_id?: string | null;
  }[]) {
    if (!deal.show_id) continue;
    if (deal.campaign_id === campaignId || (deal.outreach_id && onCampaign.has(deal.outreach_id))) {
      represented.add(deal.show_id);
    }
  }
  return [...represented];
}

async function getCampaignAdmin(id: string): Promise<Campaign | null> {
  const { data, error } = await supabaseAdmin
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data as Campaign;
}

async function optionalCampaignOverrides(campaignId: string): Promise<RawOverride[]> {
  const { data, error } = await supabaseAdmin
    .from("learning_overrides")
    .select("id, author_role, target_kind, target_key, stance, note")
    .eq("campaign_id", campaignId);
  if (error) {
    console.warn("[learning] overrides unavailable:", error.message);
    return [];
  }
  return (data ?? []) as RawOverride[];
}

function dedupeDeals(deals: DealRow[]): DealRow[] {
  const byId = new Map<string, DealRow>();
  for (const deal of deals) {
    if (deal.id) byId.set(deal.id, deal);
  }
  return [...byId.values()];
}

async function selectIn<T>(
  table: string,
  column: string,
  ids: string[],
  columns: string
): Promise<T[]> {
  const result = await selectInResult<T>(table, column, ids, columns);
  if (result.error) throw new LearningLoadError(result.error);
  return result.rows;
}

async function selectInOptional<T>(
  table: string,
  column: string,
  ids: string[],
  columns: string
): Promise<T[]> {
  const result = await selectInResult<T>(table, column, ids, columns);
  if (result.error) {
    console.warn(`[learning] ${table} unavailable:`, result.error);
    return [];
  }
  return result.rows;
}

async function selectInResult<T>(
  table: string,
  column: string,
  ids: string[],
  columns: string
): Promise<{ rows: T[]; error: string | null }> {
  if (ids.length === 0) return { rows: [], error: null };
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .in(column, slice);
    if (error) return { rows: [], error: error.message };
    out.push(...((data ?? []) as T[]));
  }
  return { rows: out, error: null };
}
