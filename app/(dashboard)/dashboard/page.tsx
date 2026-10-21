import { redirect } from "next/navigation";
import {
  getAuthenticatedUser,
  getCampaignsForUser,
  getDashboardShowCounts,
  getDealsFiltered,
  getEffectiveRole,
  getInvoicesForUser,
} from "@/lib/data/queries";
import { isBrandSide } from "@/lib/nav/items";
import { toDashboardData } from "@/lib/data/dashboard-view";
import DashboardClient from "./dashboard-client";

export default async function DashboardPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  // Start the list queries in the same turn as the role lookup. Each used to
  // wait for a client fetch after the layout had already walked the same
  // profile rows one query at a time.
  const effPromise = getEffectiveRole(user.id);
  const dealsPromise = getDealsFiltered(user.id, {});
  const invoicesPromise = getInvoicesForUser(user.id);
  const campaignsPromise = getCampaignsForUser(user.id);
  const showsPromise = getDashboardShowCounts(user.id);

  const eff = await effPromise;
  if (!eff) redirect("/onboarding");

  const [deals, invoices, campaigns, showCounts] = await Promise.all([
    dealsPromise,
    invoicesPromise,
    campaignsPromise,
    showsPromise,
  ]);

  const initial = toDashboardData({
    isBrand: isBrandSide(eff.effectiveRole),
    deals,
    invoices: invoices.invoices,
    stats: invoices.stats,
    campaigns,
    showCounts,
  });

  return <DashboardClient role={eff.effectiveRole} initial={initial} />;
}
