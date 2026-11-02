import { notFound } from "next/navigation";
import { isInternalAdmin } from "@/lib/auth/admin";
import { createSupabaseOpsDb } from "@/lib/admin/ops-db";
import { loadOpsDashboard } from "@/lib/admin/ops-dashboard";
import { parseOpsFilters } from "@/lib/admin/ops-filters";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { isShowsAdmin } from "@/lib/shows/can-edit-show";
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
  if (!user) notFound();
  // Allowlist is the session email. A profile role of admin is the other gate.
  // isShowsAdmin also accepts the allowlist on the profile email, so check the
  // session first and skip that read when the session is already allowlisted.
  if (!isInternalAdmin(user.email)) {
    const roleAdmin = await isShowsAdmin(user.id);
    if (!roleAdmin) notFound();
  }
  const filters = parseOpsFilters(await searchParams);
  const data = await loadOpsDashboard(createSupabaseOpsDb(), filters, new Date());
  return <OpsView data={data} filters={filters} />;
}
