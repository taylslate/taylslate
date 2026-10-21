import { notFound } from "next/navigation";
import { isInternalAdmin } from "@/lib/auth/admin";
import { getAuthenticatedUser } from "@/lib/data/queries";

/** Admin gate for every mockup page. Missing or non-admin sessions 404. */
export async function requireMockupAdmin(): Promise<void> {
  const user = await getAuthenticatedUser();
  if (!isInternalAdmin(user?.email)) notFound();
}
