// Rep roster reads, plus the admin approval that publishes a linked show.
//
// agentId is the signed-in user, passed in by the route. This module does
// not read a request. approveRosterLink is the write: an admin sets the
// link to approved and shows.is_discoverable to true.
//
// Deals RLS admits participants only (deals.agent_id, brand_id, agency_id,
// or a brand/show profile). A roster link is not a participant, so a rep
// cannot see another brand's deal on a represented show through the user
// client. listRosterShowDeals uses the service role after an approved link
// and returns status, flight, and the brand's display name. No price, CPM,
// total, or payment column is selected or returned.
//
// listRepDeals is the participant list: deals.agent_id is this agent, full row.

import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAgentShowRelationship } from "@/lib/data/queries";
import { isShowsAdmin } from "@/lib/shows/can-edit-show";

export interface RosterEntry {
  id: string;
  show_id: string;
  show_name: string;
  status: string;
  source: string | null;
  commission_rate: number | null;
  is_exclusive: boolean;
}

export interface RosterShowDeal {
  id: string;
  status: string;
  flight_start: string | null;
  flight_end: string | null;
  brand_name: string | null;
}

export interface RepShow {
  id: string;
  name: string;
  platform: string;
  description: string;
  audience_size: number;
  categories: string[];
  status: "approved";
  commission_rate: number | null;
  is_exclusive: boolean;
}

/** Columns a roster rep may see on someone else's deal. Nothing else. */
const ROSTER_DEAL_COLUMNS = [
  "id",
  "status",
  "flight_start",
  "flight_end",
  "profiles!deals_brand_id_fkey(company_name, full_name)",
  "brand_profiles!deals_brand_profile_id_fkey(brand_name)",
].join(", ");

const SHOW_COLUMNS = "id, name, platform, description, audience_size, categories";

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asRate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function embedded(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  return row as Record<string, unknown>;
}

function showName(value: unknown): string {
  return asText(embedded(value)?.name) ?? "";
}

function brandDisplayName(row: Record<string, unknown>): string | null {
  const brand = embedded(row.brand_profiles);
  const account = embedded(row.profiles);
  return (
    asText(brand?.brand_name) ??
    asText(account?.company_name) ??
    asText(account?.full_name)
  );
}

function toRosterEntry(row: Record<string, unknown>): RosterEntry | null {
  const id = asText(row.id);
  const showId = asText(row.show_id);
  if (!id || !showId) return null;
  return {
    id,
    show_id: showId,
    show_name: showName(row.shows),
    status: asText(row.status) ?? "",
    source: asText(row.source),
    commission_rate: asRate(row.commission_rate),
    is_exclusive: row.is_exclusive === true,
  };
}

function toRosterShowDeal(row: Record<string, unknown>): RosterShowDeal | null {
  const id = asText(row.id);
  if (!id) return null;
  return {
    id,
    status: asText(row.status) ?? "",
    flight_start: asText(row.flight_start),
    flight_end: asText(row.flight_end),
    brand_name: brandDisplayName(row),
  };
}

async function approvedLink(agentId: string, showId: string) {
  const link = await getAgentShowRelationship(agentId, showId);
  if (!link || link.status !== "approved") return null;
  return link;
}

export async function listRoster(agentId: string): Promise<RosterEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_show_relationships")
    .select(
      "id, show_id, status, source, commission_rate, is_exclusive, shows!inner(name)"
    )
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => toRosterEntry(row as Record<string, unknown>))
    .filter((row): row is RosterEntry => row !== null);
}

export async function listRepDeals(
  agentId: string
): Promise<Record<string, unknown>[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deals")
    .select("*")
    .eq("agent_id", agentId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

export async function listRosterShowDeals(
  agentId: string,
  showId: string
): Promise<RosterShowDeal[]> {
  const link = await approvedLink(agentId, showId);
  if (!link) return [];

  const { data, error } = await supabaseAdmin
    .from("deals")
    .select(ROSTER_DEAL_COLUMNS)
    .eq("show_id", showId)
    .order("flight_start", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows
    .map((row) => toRosterShowDeal(row))
    .filter((row): row is RosterShowDeal => row !== null);
}

/**
 * An admin approves one roster link and publishes that show.
 * status becomes approved. shows.is_discoverable becomes true.
 * A caller who is not an admin writes nothing.
 */
export async function approveRosterLink(
  adminUserId: string,
  relationshipId: string
): Promise<{ id: string; show_id: string; status: "approved" }> {
  if (!(await isShowsAdmin(adminUserId))) {
    throw new Error("Only an admin can approve a roster link.");
  }

  const approvedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("agent_show_relationships")
    .update({
      status: "approved",
      approved_by: adminUserId,
      approved_at: approvedAt,
    })
    .eq("id", relationshipId)
    .select("id, show_id, status")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Roster link not found.");
  }

  const showId = (data as { show_id?: unknown }).show_id;
  if (typeof showId !== "string" || !showId) {
    throw new Error("Roster link has no show.");
  }

  const { error: showError } = await supabaseAdmin
    .from("shows")
    .update({ is_discoverable: true, updated_at: approvedAt })
    .eq("id", showId);
  if (showError) {
    throw new Error(showError.message);
  }

  return { id: String((data as { id: unknown }).id), show_id: showId, status: "approved" };
}

export async function getRepShow(
  agentId: string,
  showId: string
): Promise<RepShow | null> {
  const link = await approvedLink(agentId, showId);
  if (!link) return null;

  const { data, error } = await supabaseAdmin
    .from("shows")
    .select(SHOW_COLUMNS)
    .eq("id", showId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const id = asText(row.id);
  if (!id) return null;
  return {
    id,
    name: asText(row.name) ?? "",
    platform: asText(row.platform) ?? "",
    description: asText(row.description) ?? "",
    audience_size:
      typeof row.audience_size === "number" && Number.isFinite(row.audience_size)
        ? row.audience_size
        : 0,
    categories: Array.isArray(row.categories)
      ? row.categories.filter((item): item is string => typeof item === "string")
      : [],
    status: "approved",
    commission_rate: asRate(link.commission_rate),
    is_exclusive: link.is_exclusive === true,
  };
}
