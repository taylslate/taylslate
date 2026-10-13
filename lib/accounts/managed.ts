// Managed ("concierge") brand accounts.
//
// Chris runs these profiles himself. is_managed lives on profiles and is
// writable only through the service role (see migration 041). Callers that
// email a brand or send DocuSign ask here before they act.

import { supabaseAdmin } from "@/lib/supabase/admin";

export interface ManagedBrandRow {
  id: string;
  email: string;
  name: string;
  isManaged: boolean;
}

interface ProfileListRow {
  id: string;
  email: string | null;
  full_name: string | null;
  company_name: string | null;
  is_managed: boolean | null;
}

interface BrandNameRow {
  user_id: string;
  brand_name: string | null;
  brand_identity: string | null;
}

function displayName(
  profile: ProfileListRow,
  brand: BrandNameRow | undefined,
): string {
  const named = brand?.brand_name?.trim();
  if (named) return named;
  const identity = brand?.brand_identity?.split(/[.,—–-]/)[0]?.trim();
  if (identity) return identity;
  return (
    profile.company_name?.trim() ||
    profile.full_name?.trim() ||
    profile.email?.trim() ||
    "Brand"
  );
}

/** True when the brand_profiles row's user is a managed account. */
export async function isBrandProfileManaged(
  brandProfileId: string | null | undefined,
): Promise<boolean> {
  if (!brandProfileId) return false;
  const { data: brand, error } = await supabaseAdmin
    .from("brand_profiles")
    .select("user_id")
    .eq("id", brandProfileId)
    .single();
  if (error || !brand?.user_id) return false;
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("is_managed")
    .eq("id", brand.user_id as string)
    .single();
  if (profileError || !profile) return false;
  return profile.is_managed === true;
}

/** Brand profiles for the admin toggle. Service role. */
export async function listManagedBrands(): Promise<ManagedBrandRow[]> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email, full_name, company_name, is_managed")
    .eq("role", "brand")
    .order("email", { ascending: true });
  if (error || !data) return [];

  const profiles = data as ProfileListRow[];
  const ids = profiles.map((row) => row.id);
  let names: BrandNameRow[] = [];
  if (ids.length > 0) {
    const { data: brandRows } = await supabaseAdmin
      .from("brand_profiles")
      .select("user_id, brand_name, brand_identity")
      .in("user_id", ids);
    names = (brandRows ?? []) as BrandNameRow[];
  }
  const byUser = new Map(names.map((row) => [row.user_id, row]));

  return profiles.map((profile) => ({
    id: profile.id,
    email: profile.email ?? "",
    name: displayName(profile, byUser.get(profile.id)),
    isManaged: profile.is_managed === true,
  }));
}
