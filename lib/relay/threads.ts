// Service-role relay threads. Fail soft when migration 094 is absent.
// Do not import this module from a client component.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { randomRelayToken } from "@/lib/relay/address";

export interface RelayThread {
  id: string;
  outreach_id: string;
  deal_id: string | null;
  brand_user_id: string;
  brand_profile_id: string;
  address_token: string;
  brand_display_name: string;
  show_display_name: string;
  created_at: string;
}

const COLUMNS =
  "id, outreach_id, deal_id, brand_user_id, brand_profile_id, address_token, brand_display_name, show_display_name, created_at";

export async function createRelayThread(input: {
  outreachId: string;
  brandUserId: string;
  brandProfileId: string;
  brandDisplayName: string;
  showDisplayName: string;
}): Promise<RelayThread | null> {
  const row = {
    outreach_id: input.outreachId,
    brand_user_id: input.brandUserId,
    brand_profile_id: input.brandProfileId,
    address_token: randomRelayToken(),
    brand_display_name: displayName(input.brandDisplayName, "Brand"),
    show_display_name: displayName(input.showDisplayName, "Show"),
  };
  try {
    const { data, error } = await supabaseAdmin
      .from("relay_threads")
      .insert(row)
      .select(COLUMNS)
      .single();
    if (!error && data) return data as RelayThread;
    if (error?.code === "23505") {
      const existing = await loadByOutreach(input.outreachId);
      if (existing) return existing;
    }
    console.warn("[relay] thread create failed", error?.code ?? "unknown");
    return null;
  } catch (error) {
    console.warn("[relay] thread create failed", errorCode(error));
    return null;
  }
}

export async function linkThreadToDeal(outreachId: string, dealId: string): Promise<null> {
  try {
    const { error } = await supabaseAdmin
      .from("relay_threads")
      .update({ deal_id: dealId })
      .eq("outreach_id", outreachId);
    if (error) console.warn("[relay] thread link failed", error.code ?? "unknown");
  } catch (error) {
    console.warn("[relay] thread link failed", errorCode(error));
  }
  return null;
}

export async function findThreadByToken(token: string): Promise<RelayThread | null> {
  if (typeof token !== "string" || !/^[a-z2-7]{26}$/.test(token.trim().toLowerCase())) return null;
  const normalized = token.trim().toLowerCase();
  try {
    const { data, error } = await supabaseAdmin
      .from("relay_threads")
      .select(COLUMNS)
      .eq("address_token", normalized)
      .maybeSingle();
    if (error) {
      console.warn("[relay] thread lookup failed", error.code ?? "unknown");
      return null;
    }
    return (data as RelayThread | null) ?? null;
  } catch (error) {
    console.warn("[relay] thread lookup failed", errorCode(error));
    return null;
  }
}

async function loadByOutreach(outreachId: string): Promise<RelayThread | null> {
  const { data, error } = await supabaseAdmin
    .from("relay_threads")
    .select(COLUMNS)
    .eq("outreach_id", outreachId)
    .maybeSingle();
  if (error || !data) return null;
  return data as RelayThread;
}

function displayName(raw: string, fallback: string): string {
  const cleaned = (raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const name = cleaned || fallback;
  return name.slice(0, 120);
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
  }
  return "unknown";
}
