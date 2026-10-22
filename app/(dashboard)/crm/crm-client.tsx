"use client";

import Link from "next/link";
import { crmCard, crmMuted, crmRadius } from "./components/chrome";
import { CrmShell, crmIndexLede } from "./components/shell";
import type { CrmShowView } from "./components/types";

export function CrmClient({
  shows,
  brandName,
}: {
  shows: CrmShowView[];
  brandName: string;
}) {
  return (
    <CrmShell kicker="CRM" title="Brand CRM" lede={crmIndexLede(brandName)}>
      {shows.length === 0 ? (
        <p className={crmMuted}>No shows yet.</p>
      ) : (
        <ul className="space-y-3" data-testid="crm-show-list">
          {shows.map((show) => (
            <li key={show.id}>
              <Link
                href={`/crm/${show.id}`}
                className={`${crmCard} block hover:bg-[var(--ts-band-shows)]`}
                style={crmRadius}
              >
                <p className="font-medium">{show.name || "Untitled show"}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CrmShell>
  );
}
