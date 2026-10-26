import { notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { listPendingRosterLinks } from "@/lib/reps/roster-review";
import { isShowsAdmin } from "@/lib/shows/can-edit-show";
import { RosterRequestsClient } from "./roster-requests-client";

export default async function RosterRequestsPage() {
  const user = await getAuthenticatedUser();
  if (!user || !(await isShowsAdmin(user.id))) notFound();
  const links = await listPendingRosterLinks();
  return <RosterRequestsClient links={links} />;
}
