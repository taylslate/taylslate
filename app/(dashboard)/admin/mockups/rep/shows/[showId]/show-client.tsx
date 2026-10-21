"use client";

import { useState } from "react";
import Link from "next/link";
import {
  REP_DEALS,
  REP_NAV,
  formatDay,
  formatFlight,
  getRosterShow,
  labelOf,
} from "../../../fixtures";
import {
  ExclusiveToggle,
  MockupLinks,
  MockupPage,
  StatusPill,
  mockupCard,
  mockupMuted,
  mockupRadius,
} from "../../../chrome";

export function RepShowClient({ showId }: { showId: string }) {
  const link = getRosterShow(showId);
  const [exclusive, setExclusive] = useState(link?.isExclusive ?? true);
  const flights = REP_DEALS.filter((deal) => deal.showId === showId);

  if (!link) {
    return (
      <MockupPage kicker="Rep" title="Show">
        <p className={mockupMuted}>This show is not on the preview roster.</p>
      </MockupPage>
    );
  }

  return (
    <MockupPage
      kicker="Rep"
      title={link.showName}
      lede={`${link.agentName}. Roster link. Status and flights only.`}
    >
      <MockupLinks links={REP_NAV} label="Rep screens" />
      <div className={`${mockupCard} space-y-3`} style={mockupRadius}>
        <p>
          <StatusPill>{labelOf(link.status)}</StatusPill>
          <span className={`ml-2 ${mockupMuted}`}>{labelOf(link.source)}</span>
        </p>
        <ExclusiveToggle
          on={exclusive}
          showName={link.showName}
          onToggle={() => setExclusive((current) => !current)}
        />
        {link.approvedAt ? (
          <p className={mockupMuted}>Approved {formatDay(link.approvedAt)}.</p>
        ) : null}
      </div>
      <h2 className="mt-8 text-lg font-semibold">Flights</h2>
      {flights.length === 0 ? (
        <p className={`mt-3 ${mockupMuted}`}>No flights on this roster link.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {flights.map((flight) => (
            <li key={flight.id} className={mockupCard} style={mockupRadius}>
              <StatusPill>{labelOf(flight.status)}</StatusPill>
              <p className={`mt-2 ${mockupMuted}`}>
                {formatFlight(flight.flightStart, flight.flightEnd)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Link
        href="/admin/mockups/rep"
        className="mt-6 inline-block text-sm text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
      >
        Back to roster
      </Link>
    </MockupPage>
  );
}
