import DocuSignUsageLine from "./docusign-usage-line";
import ManagedBrandsClient from "./managed-brands-client";
import { listManagedBrands } from "@/lib/accounts/managed";
import { isInternalAdmin } from "@/lib/auth/admin";
import { getAuthenticatedUser } from "@/lib/data/queries";

export default async function ManagedBrandsPage() {
  const user = await getAuthenticatedUser();
  if (!user || !isInternalAdmin(user.email)) {
    return (
      <div className="max-w-2xl p-4 sm:p-8">
        <p className="text-sm text-[var(--ts-ink-muted-on-paper)]">
          This page is for Taylslate admins.
        </p>
      </div>
    );
  }

  const brands = await listManagedBrands();
  return (
    <>
      <div>
        <DocuSignUsageLine />
      </div>
      <ManagedBrandsClient brands={brands} />
    </>
  );
}
