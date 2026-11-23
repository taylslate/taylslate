import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  getDealWithRelations,
  getDealById,
  updateDeal,
  deleteDeal,
  getWave12DealById,
  getOutreachById,
  getBrandProfileByUserId,
  getShowProfileByUserId,
} from "@/lib/data/queries";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { redactOutreach } from "@/lib/outreach/public";
import type { DealStatus, BrandProfile, ShowProfile } from "@/lib/data/types";

const VALID_STATUSES: DealStatus[] = ["planning", "io_sent", "live", "completed"];

const REFUSAL = "That update is not allowed.";

// Buyer side: the legacy brand_id, the agency, or the brand profile owner.
// Show side: the legacy agent_id, or the show profile owner.
// Money, identity, payment, and signature columns are absent from both lists.
const BUYER_FIELDS = [
  "notes",
  "status",
  "placement",
  "ad_format",
  "flight_start",
  "flight_end",
  "is_scripted",
  "is_personal_experience",
  "reader_type",
  "content_type",
  "pixel_required",
  "competitor_exclusion",
  "exclusivity_days",
  "rofr_days",
] as const;

const SHOW_FIELDS = ["notes", "status"] as const;

const PLACEMENTS = ["pre-roll", "mid-roll", "post-roll"] as const;
const AD_FORMATS = [
  "host_read",
  "scripted",
  "personal_experience",
  "dynamic_insertion",
  "integration",
] as const;
const READER_TYPES = ["host_read", "producer_read", "guest_read"] as const;
const CONTENT_TYPES = ["evergreen", "dated"] as const;

/** profiles.is_managed for the deal's brand. A lookup failure stays false so the GET still returns. */
async function brandIsManaged(brandId: unknown): Promise<boolean> {
  if (typeof brandId !== "string" || !brandId) return false;
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("is_managed")
    .eq("id", brandId)
    .single();
  if (error || !data) return false;
  return (data as { is_managed?: boolean | null }).is_managed === true;
}

// Ownership gate for a single deal. These routes read/mutate via the admin
// client (which bypasses RLS), so authorization MUST be enforced here. Without
// it any authenticated user could read or mutate any deal by UUID. Covers both
// legacy ownership (brand/agent/agency_id = user, migration 001) and Wave-12
// ownership (brand_profile_id / show_profile_id resolved from the caller,
// migration 013). `deal` is the raw row so both column families are present.
async function callerOwnsDeal(
  userId: string,
  deal: Record<string, unknown>
): Promise<boolean> {
  if (
    deal.brand_id === userId ||
    deal.agent_id === userId ||
    deal.agency_id === userId
  ) {
    return true;
  }
  const [brandProfile, showProfile] = await Promise.all([
    getBrandProfileByUserId(userId),
    getShowProfileByUserId(userId),
  ]);
  if (deal.brand_profile_id && brandProfile?.id === deal.brand_profile_id) return true;
  if (deal.show_profile_id && showProfile?.id === deal.show_profile_id) return true;
  return false;
}

// Legacy board transitions. "completed" is not a party-settable target.
const VALID_TRANSITIONS: Record<DealStatus, DealStatus[]> = {
  planning: ["io_sent"],
  io_sent: ["live"],
  live: [],
  completed: [],
};

function isSigned(deal: Record<string, unknown>): boolean {
  const brandSigned =
    typeof deal.brand_signed_at === "string" && deal.brand_signed_at.trim().length > 0;
  const showSigned =
    typeof deal.show_signed_at === "string" && deal.show_signed_at.trim().length > 0;
  return brandSigned || showSigned;
}

function hasEnvelope(deal: Record<string, unknown>): boolean {
  return (
    typeof deal.docusign_envelope_id === "string" && deal.docusign_envelope_id.trim().length > 0
  );
}

function isLocked(deal: Record<string, unknown>): boolean {
  return isSigned(deal) || hasEnvelope(deal);
}

// The legacy deal screen always resends these. An equal value is dropped.
// A different value is refused. They are never written.
const ECHO_MONEY_KEYS = [
  "price_type",
  "cpm_rate",
  "guaranteed_downloads",
  "num_episodes",
  "net_per_episode",
  "total_net",
] as const;

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function sameStoredMoney(key: string, incoming: unknown, stored: unknown): boolean {
  if (key === "price_type") return typeof incoming === "string" && incoming === stored;
  const left = finiteNumber(incoming);
  const right = finiteNumber(stored);
  if (left === null || right === null) return false;
  return Math.round(left * 100) === Math.round(right * 100);
}

async function priceRecordExists(dealId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("deal_price_records")
    .select("id")
    .eq("deal_id", dealId)
    .maybeSingle();
  if (error) {
    const code = typeof error.code === "string" ? error.code : "";
    if (code === "42P01" || code === "PGRST205" || code === "PGRST204") return false;
    console.error("[deal delete] price record lookup failed", code.slice(0, 32));
    throw new Error("lookup_failed");
  }
  return data != null;
}

async function callerParties(
  userId: string,
  deal: Record<string, unknown>
): Promise<{ buyer: boolean; show: boolean }> {
  let buyer = deal.brand_id === userId || deal.agency_id === userId;
  let show = deal.agent_id === userId;
  const [brandProfile, showProfile] = await Promise.all([
    getBrandProfileByUserId(userId),
    getShowProfileByUserId(userId),
  ]);
  if (deal.brand_profile_id && brandProfile?.id === deal.brand_profile_id) buyer = true;
  if (deal.show_profile_id && showProfile?.id === deal.show_profile_id) show = true;
  return { buyer, show };
}

function allowedFields(parties: { buyer: boolean; show: boolean }): Set<string> {
  const fields = new Set<string>();
  if (parties.buyer) {
    for (const field of BUYER_FIELDS) fields.add(field);
  }
  if (parties.show) {
    for (const field of SHOW_FIELDS) fields.add(field);
  }
  return fields;
}

function cleanEnum(value: unknown, allowed: readonly string[]): string | null {
  if (typeof value !== "string" || !allowed.includes(value)) return null;
  return value;
}

function cleanDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
}

function cleanInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

function cleanNotes(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 4000) return undefined;
  return value;
}

function cleanExclusion(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 40) return null;
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > 120) return null;
    names.push(trimmed);
  }
  return names;
}

function refusal(status: 400 | 403): NextResponse {
  return NextResponse.json({ error: REFUSAL }, { status });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    console.log(`[GET /api/deals/${id}] user=${user.id}`);

    // Authorization: these handlers use the admin client, so ownership must be
    // checked here. Load the raw row once and gate before returning any data.
    const dealRow = await getDealById(id);
    if (!dealRow) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    if (!(await callerOwnsDeal(user.id, dealRow as unknown as Record<string, unknown>))) {
      // 404 (not 403) so a non-owner can't probe which deal UUIDs exist.
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const deal = await getDealWithRelations(id);

    if (deal && deal.show_name) {
      console.log(
        `[GET /api/deals/${id}] Found legacy deal: brand_id=${deal.brand_id} agent_id=${deal.agent_id} show=${deal.show_name}`
      );
      return NextResponse.json({
        deal: { ...deal, brand_is_managed: await brandIsManaged(deal.brand_id) },
      });
    }

    // Wave 12 fallback — outreach-driven deals don't join through shows table.
    const wave12 = await getWave12DealById(id);
    if (wave12 && wave12.outreach_id) {
      const outreach = await getOutreachById(wave12.outreach_id);
      const { data: bp } = await supabaseAdmin
        .from("brand_profiles")
        .select("id, brand_identity, brand_website")
        .eq("id", wave12.brand_profile_id)
        .single();
      // show_profile_id is null until the show onboards — skip the lookup and
      // fall back to the outreach's show_name below.
      const { data: sp } = wave12.show_profile_id
        ? await supabaseAdmin
            .from("show_profiles")
            .select("id, show_name")
            .eq("id", wave12.show_profile_id)
            .single()
        : { data: null };
      const brandName =
        (bp as BrandProfile | null)?.brand_identity?.split(/[.,—–-]/)[0]?.trim() ||
        (bp as BrandProfile | null)?.brand_website ||
        "Brand";
      return NextResponse.json({
        deal: {
          ...wave12,
          show_name: (sp as ShowProfile | null)?.show_name ?? outreach?.show_name ?? "Show",
          brand_name: brandName,
          brand_is_managed: await brandIsManaged(
            (wave12 as { brand_id?: unknown }).brand_id
          ),
          outreach: outreach ? redactOutreach(outreach) : outreach,
        },
      });
    }

    console.error(`[GET /api/deals/${id}] Deal not found for user ${user.id}`);
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Failed to fetch deal" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const existing = await getDealById(id);

    if (!existing) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    if (!(await callerOwnsDeal(user.id, existing as unknown as Record<string, unknown>))) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return refusal(400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return refusal(400);
    }

    const raw = body as Record<string, unknown>;
    if (Object.keys(raw).length === 0) return refusal(400);

    const parties = await callerParties(
      user.id,
      existing as unknown as Record<string, unknown>
    );
    if (!parties.buyer && !parties.show) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const row = existing as unknown as Record<string, unknown>;
    if (isLocked(row)) return refusal(403);

    const pending: Record<string, unknown> = { ...raw };
    for (const key of ECHO_MONEY_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(pending, key)) continue;
      if (!sameStoredMoney(key, pending[key], row[key])) return refusal(400);
      delete pending[key];
    }
    const keys = Object.keys(pending);
    if (keys.length === 0) return refusal(400);

    const allowed = allowedFields(parties);
    if (keys.some((key) => !allowed.has(key))) return refusal(400);

    const updates: Record<string, unknown> = {};
    for (const key of keys) {
      const value = pending[key];
      if (key === "notes") {
        const notes = cleanNotes(value);
        if (notes === undefined) return refusal(400);
        updates.notes = notes;
      } else if (key === "status") {
        if (value === "completed") return refusal(403);
        const next = cleanEnum(value, VALID_STATUSES);
        if (!next || next === "completed") return refusal(400);
        if (next !== existing.status) {
          const transitions = VALID_TRANSITIONS[existing.status as DealStatus];
          if (!transitions || !transitions.includes(next as DealStatus)) return refusal(400);
        }
        updates.status = next;
      } else if (key === "placement") {
        const placement = cleanEnum(value, PLACEMENTS);
        if (!placement) return refusal(400);
        updates.placement = placement;
      } else if (key === "ad_format") {
        const adFormat = cleanEnum(value, AD_FORMATS);
        if (!adFormat) return refusal(400);
        updates.ad_format = adFormat;
      } else if (key === "flight_start" || key === "flight_end") {
        const date = cleanDate(value);
        if (!date) return refusal(400);
        updates[key] = date;
      } else if (
        key === "is_scripted" ||
        key === "is_personal_experience" ||
        key === "pixel_required"
      ) {
        if (typeof value !== "boolean") return refusal(400);
        updates[key] = value;
      } else if (key === "reader_type") {
        const reader = cleanEnum(value, READER_TYPES);
        if (!reader) return refusal(400);
        updates.reader_type = reader;
      } else if (key === "content_type") {
        const content = cleanEnum(value, CONTENT_TYPES);
        if (!content) return refusal(400);
        updates.content_type = content;
      } else if (key === "competitor_exclusion") {
        const names = cleanExclusion(value);
        if (!names) return refusal(400);
        updates.competitor_exclusion = names;
      } else if (key === "exclusivity_days" || key === "rofr_days") {
        const days = cleanInt(value, 0, 3650);
        if (days === null) return refusal(400);
        updates[key] = days;
      } else {
        return refusal(400);
      }
    }

    const deal = await updateDeal(id, updates as Parameters<typeof updateDeal>[1]);
    if (!deal) {
      return NextResponse.json({ error: "Failed to update deal" }, { status: 500 });
    }

    return NextResponse.json({ deal });
  } catch {
    return NextResponse.json({ error: "Failed to update deal" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const existing = await getDealById(id);

    if (!existing) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    if (!(await callerOwnsDeal(user.id, existing as unknown as Record<string, unknown>))) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    // Completed deals cannot be deleted
    if (existing.status === "completed") {
      return NextResponse.json(
        { error: "Cannot delete a completed deal" },
        { status: 400 }
      );
    }

    const row = existing as unknown as Record<string, unknown>;
    if (isLocked(row) || (await priceRecordExists(id))) {
      return NextResponse.json({ error: "That delete is not allowed." }, { status: 403 });
    }

    const success = await deleteDeal(id);
    if (!success) {
      return NextResponse.json({ error: "Failed to delete deal" }, { status: 500 });
    }

    return NextResponse.json({ message: "Deal deleted" });
  } catch {
    return NextResponse.json({ error: "Failed to delete deal" }, { status: 500 });
  }
}
