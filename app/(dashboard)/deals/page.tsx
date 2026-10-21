import { redirect } from "next/navigation";
import { getAuthenticatedUser, getDealsFiltered } from "@/lib/data/queries";
import DealsClient from "./deals-client";

export default async function DealsPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  const deals = await getDealsFiltered(user.id, {});
  return <DealsClient initialDeals={deals} />;
}
