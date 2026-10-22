import Link from "next/link";
import { PLANS } from "@/lib/billing/plans";
import { crmCard, crmKicker, crmMuted, crmRadius, primaryButtonClass } from "./chrome";

function monthly(cents: number): string {
  if (cents === 0) return "$0";
  return `$${(cents / 100).toLocaleString("en-US")}`;
}

function campaignLine(cap: number | null): string {
  if (cap === null) return "unlimited active campaigns";
  if (cap === 1) return "1 active campaign";
  return `${cap} active campaigns`;
}

export function UpgradeCard() {
  const free = PLANS.pay_as_you_go;
  const starter = PLANS.starter;

  return (
    <section
      className={`${crmCard} px-5 py-5`}
      style={crmRadius}
      data-testid="crm-upgrade-card"
      aria-labelledby="crm-upgrade-title"
    >
      <p className={crmKicker}>Free plan</p>
      <h2 id="crm-upgrade-title" className="mt-2 text-xl font-semibold">
        CRM is included with Starter
      </h2>
      <p className={`mt-2 ${crmMuted}`}>
        Free includes {campaignLine(free.concurrentCampaignCap)}. Starter is{" "}
        {monthly(starter.monthlyBaseCents)} a month and includes CRM, with{" "}
        {campaignLine(starter.concurrentCampaignCap)}. Operator includes CRM as well.
      </p>
      <Link href="/settings/billing" className={`${primaryButtonClass} mt-4`} style={crmRadius}>
        Upgrade to Starter
      </Link>
    </section>
  );
}
