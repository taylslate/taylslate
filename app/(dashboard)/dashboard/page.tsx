import { redirect } from "next/navigation";
import { getAuthenticatedUser, getEffectiveRole } from "@/lib/data/queries";
import DashboardClient from "./dashboard-client";

export default async function DashboardPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  const eff = await getEffectiveRole(user.id);
  if (!eff) redirect("/onboarding");

  return <DashboardClient role={eff.effectiveRole} />;
}
