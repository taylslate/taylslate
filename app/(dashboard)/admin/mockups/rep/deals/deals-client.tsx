"use client";

import Link from "next/link";
import { REP_DEALS, REP_NAV, formatFlight, labelOf } from "../../fixtures";
import { MockupLinks, MockupPage, StatusPill } from "../../chrome";

export function RepDealsClient() {
  return (
    <MockupPage
      kicker="Rep"
      title="Rep deals"
      lede="A roster link shows the deal status and the flight. Amounts stay on the brand deal."
      wide
    >
      <MockupLinks links={REP_NAV} label="Rep screens" />
      <div className="overflow-x-auto" data-testid="rep-deals">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Roster link deals</caption>
          <thead>
            <tr className="border-b border-[var(--ts-hairline-on-paper)] text-[var(--ts-ink-muted-on-paper)]">
              <th className="py-2 pr-4 font-medium">Show</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 font-medium">Flight</th>
            </tr>
          </thead>
          <tbody>
            {REP_DEALS.map((deal) => (
              <tr key={deal.id} className="border-b border-[var(--ts-hairline-on-paper)]">
                <td className="py-3 pr-4">
                  <Link
                    href={`/admin/mockups/rep/shows/${deal.showId}`}
                    className="font-medium hover:underline"
                  >
                    {deal.showName}
                  </Link>
                </td>
                <td className="py-3 pr-4">
                  <StatusPill>{labelOf(deal.status)}</StatusPill>
                </td>
                <td className="py-3">{formatFlight(deal.flightStart, deal.flightEnd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </MockupPage>
  );
}
