import { listCrmShows } from "@/lib/crm/store";
import { requireBrandCrmAccess } from "./access";
import { CrmClient } from "./crm-client";
import { CrmShell, crmIndexLede } from "./components/shell";
import { UpgradeCard } from "./components/upgrade-card";

export default async function CrmPage() {
  const access = await requireBrandCrmAccess();
  if (!access.ok) {
    return (
      <CrmShell kicker="CRM" title="Brand CRM" lede={crmIndexLede(access.brandName)}>
        <UpgradeCard />
      </CrmShell>
    );
  }

  const shows = await listCrmShows(access.userId);
  return <CrmClient shows={shows} brandName={access.brandName} />;
}
