import { notFound } from "next/navigation";
import { isInternalAdmin } from "@/lib/auth/admin";
import { createSupabaseOpsDb } from "@/lib/admin/ops-db";
import { loadOpsDashboard } from "@/lib/admin/ops-dashboard";
import { parseOpsFilters } from "@/lib/admin/ops-filters";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { OpsView } from "./ops-view";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Operations",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AdminOpsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getAuthenticatedUser();
  // Session email only. profiles.email is writable by the signed-in user, and
  // profiles.role cannot be admin. Neither one may open this page.
  if (!user || !isInternalAdmin(user.email)) notFound();
  const filters = parseOpsFilters(await searchParams);
  const data = await loadOpsDashboard(createSupabaseOpsDb(), filters, new Date());
  return <OpsView data={data} filters={filters} />;
}
