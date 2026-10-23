import { redirect } from "next/navigation";
import { requireBrandCrmAccess } from "@/app/(dashboard)/crm/access";
import { getAuthenticatedUser } from "@/lib/data/queries";
import type { CatalogHint } from "@/lib/imports/review";
import { createClient } from "@/lib/supabase/server";
import { ImportReviewClient } from "./import-review-client";

// Advisory catalog names for the review table. Reads shows. Does not write.
export async function lookupCatalogNames(names: string[]): Promise<CatalogHint[]> {
  "use server";
  await requireBrandCrmAccess();
  if (!Array.isArray(names)) return [];

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const jobs: Promise<CatalogHint[]>[] = [];
  for (const name of names.slice(0, 2000)) {
    if (typeof name !== "string") continue;
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    jobs.push(lookupOneShow(supabase, trimmed));
  }
  const groups = await Promise.all(jobs);
  return groups.flat();
}

async function lookupOneShow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  name: string,
): Promise<CatalogHint[]> {
  try {
    const { data, error } = await supabase
      .from("shows")
      .select("id, name")
      .ilike("name", name)
      .limit(2);
    if (error || !Array.isArray(data)) return [];
    const hints: CatalogHint[] = [];
    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      const id = (row as { id?: unknown }).id;
      const showName = (row as { name?: unknown }).name;
      if (typeof id === "string" && typeof showName === "string") {
        hints.push({ id, name: showName });
      }
    }
    return hints;
  } catch {
    return [];
  }
}

export default async function PastCampaignImportPage() {
  const access = await requireBrandCrmAccess();
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  return (
    <ImportReviewClient
      brandId={user.id}
      brandName={access.brandName}
      lookupCatalog={lookupCatalogNames}
    />
  );
}
