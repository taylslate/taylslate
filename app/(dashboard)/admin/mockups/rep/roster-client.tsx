"use client";

import { useState } from "react";
import Link from "next/link";
import { ROSTER_LINKS, REP_NAV, labelOf, type MockRosterLink } from "../fixtures";
import {
  ExclusiveToggle,
  MockupLinks,
  MockupPage,
  StatusPill,
  mockupCard,
  mockupMuted,
  mockupRadius,
} from "../chrome";

export function RosterClient() {
  const [links, setLinks] = useState<MockRosterLink[]>(() =>
    ROSTER_LINKS.map((link) => ({ ...link })),
  );

  function toggleExclusive(id: string) {
    setLinks((current) =>
      current.map((link) => (link.id === id ? { ...link, isExclusive: !link.isExclusive } : link)),
    );
  }

  return (
    <MockupPage
      kicker="Rep"
      title="Rep roster"
      lede="Northwind Talent. Exclusive starts on for every show. Turning it off stays in this preview."
      wide
    >
      <MockupLinks links={REP_NAV} label="Rep screens" />
      <ul className="space-y-3">
        {links.map((link) => (
          <li
            key={link.id}
            className={`${mockupCard} flex flex-wrap items-center justify-between gap-3`}
            style={mockupRadius}
          >
            <div>
              <Link
                href={`/admin/mockups/rep/shows/${link.showId}`}
                className="font-medium hover:underline"
              >
                {link.showName}
              </Link>
              <p className={`mt-1 ${mockupMuted}`}>
                <StatusPill>{labelOf(link.status)}</StatusPill>{" "}
                <span className="ml-2">{labelOf(link.source)}</span>
              </p>
            </div>
            <ExclusiveToggle
              on={link.isExclusive}
              showName={link.showName}
              onToggle={() => toggleExclusive(link.id)}
            />
          </li>
        ))}
      </ul>
    </MockupPage>
  );
}
