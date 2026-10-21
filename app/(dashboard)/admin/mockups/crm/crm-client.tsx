"use client";

import { useState } from "react";
import Link from "next/link";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import {
  CRM_SHOWS,
  PREVIEW_PLANS,
  previewCanUseCrm,
} from "../fixtures";
import {
  MockupPage,
  ghostButtonClass,
  mockupCard,
  mockupKicker,
  mockupMuted,
  mockupRadius,
  primaryButtonClass,
} from "../chrome";

function monthly(cents: number): string {
  if (cents === 0) return "$0";
  return `$${(cents / 100).toLocaleString("en-US")}`;
}

function campaignLine(cap: number | null): string {
  if (cap === null) return "unlimited active campaigns";
  if (cap === 1) return "1 active campaign";
  return `${cap} active campaigns`;
}

export function CrmClient() {
  const [planId, setPlanId] = useState<PlanId>("pay_as_you_go");
  const unlocked = previewCanUseCrm(planId);
  const free = PLANS.pay_as_you_go;
  const starter = PLANS.starter;

  return (
    <MockupPage
      kicker="CRM"
      title="Brand CRM"
      lede="Sauna Box. Contacts and notes are stored per show. Deal history stays read-only."
    >
      <div className="mb-6" role="group" aria-label="Preview plan">
        <p className={mockupMuted}>Preview plan</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {PREVIEW_PLANS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={planId === id}
              className={planId === id ? primaryButtonClass : ghostButtonClass}
              style={mockupRadius}
              onClick={() => setPlanId(id)}
            >
              {PLANS[id].label}
            </button>
          ))}
        </div>
      </div>

      {unlocked ? (
        <ul className="space-y-3" data-testid="crm-show-list">
          {CRM_SHOWS.map((show) => (
            <li key={show.id}>
              <Link
                href={`/admin/mockups/crm/${show.id}`}
                className={`${mockupCard} block hover:bg-[var(--ts-band-shows)]`}
                style={mockupRadius}
              >
                <p className="font-medium">{show.name}</p>
                <p className={mockupMuted}>{show.medium}</p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <section
          className={`${mockupCard} px-5 py-5`}
          style={mockupRadius}
          data-testid="crm-upgrade-card"
          aria-labelledby="crm-upgrade-title"
        >
          <p className={mockupKicker}>Free plan</p>
          <h2 id="crm-upgrade-title" className="mt-2 text-xl font-semibold">
            CRM is included with Starter
          </h2>
          <p className={`mt-2 ${mockupMuted}`}>
            Free includes {campaignLine(free.concurrentCampaignCap)}. Starter is{" "}
            {monthly(starter.monthlyBaseCents)} a month and includes CRM, with{" "}
            {campaignLine(starter.concurrentCampaignCap)}. Operator includes CRM as well.
          </p>
          <button
            type="button"
            className={`${primaryButtonClass} mt-4`}
            style={mockupRadius}
            onClick={() => setPlanId("starter")}
          >
            Upgrade to Starter
          </button>
          <p className={`mt-2 ${mockupMuted}`}>
            This button only opens the Starter preview.
          </p>
        </section>
      )}
    </MockupPage>
  );
}
