import { notFound, redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { readProfileRole } from "@/lib/api/approvals/list";
import AssistantClient from "./assistant-client";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?next=/assistant");

  const role = await readProfileRole(user.id);
  if (role !== "brand") notFound();

  return <AssistantClient />;
}
