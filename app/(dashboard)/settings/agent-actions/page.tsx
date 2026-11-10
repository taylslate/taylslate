import { notFound, redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { readProfileRole } from "@/lib/api/approvals/list";
import AgentActionsClient from "./agent-actions-client";

export const dynamic = "force-dynamic";

export default async function AgentActionsPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?next=/settings/agent-actions");

  const role = await readProfileRole(user.id);
  if (role !== "brand") notFound();

  return <AgentActionsClient />;
}
