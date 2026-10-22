import { redirect } from "next/navigation";
import {
  getAuthenticatedUser,
  getBrandProfileByUserId,
  getEffectiveRole,
  getUserProfile,
} from "@/lib/data/queries";
import { canUseCrm, getProfilePlanId } from "@/lib/entitlements/plan";
import { isBrandSide } from "@/lib/nav/items";

export type BrandCrmAccess =
  | { ok: false; brandName: string }
  | { ok: true; userId: string; brandName: string };

function brandLabel(
  brand: { brand_name?: string | null } | null,
  profile: { company_name?: string | null } | null,
): string {
  const named = brand?.brand_name?.trim();
  if (named) return named;
  return profile?.company_name?.trim() ?? "";
}

export async function requireBrandCrmAccess(): Promise<BrandCrmAccess> {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  const role = await getEffectiveRole(user.id);
  if (!role) redirect("/onboarding");
  if (!isBrandSide(role.effectiveRole)) redirect("/dashboard");

  const [planId, brand, profile] = await Promise.all([
    getProfilePlanId(user.id),
    getBrandProfileByUserId(user.id),
    getUserProfile(user.id),
  ]);
  const brandName = brandLabel(brand, profile);
  if (!canUseCrm(planId)) return { ok: false, brandName };
  return { ok: true, userId: user.id, brandName };
}
