// A relay is unlocked only after both sides have signed and the deal
// is not cancelled. Missing data stays locked.

export function isRelayUnlocked(
  deal: {
    show_signed_at?: string | null;
    brand_signed_at?: string | null;
    status?: string | null;
  } | null
): boolean {
  if (!deal || typeof deal !== "object") return false;
  const showSigned = typeof deal.show_signed_at === "string" && deal.show_signed_at.trim() !== "";
  const brandSigned = typeof deal.brand_signed_at === "string" && deal.brand_signed_at.trim() !== "";
  if (!showSigned || !brandSigned) return false;
  if (typeof deal.status !== "string" || deal.status.trim() === "") return false;
  return deal.status !== "cancelled";
}
