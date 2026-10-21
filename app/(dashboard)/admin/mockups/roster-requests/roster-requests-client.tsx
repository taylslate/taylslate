"use client";

import { useState } from "react";
import {
  ROSTER_REQUESTS,
  formatDay,
  labelOf,
  type MockRosterLink,
  type RosterStatus,
} from "../fixtures";
import {
  ExclusiveMark,
  MockupPage,
  StatusPill,
  ghostButtonClass,
  mockupCard,
  mockupMuted,
  mockupRadius,
  primaryButtonClass,
} from "../chrome";

const TABS: RosterStatus[] = ["pending", "approved", "rejected"];

export function RosterRequestsClient() {
  const [rows, setRows] = useState<MockRosterLink[]>(() =>
    ROSTER_REQUESTS.map((row) => ({ ...row })),
  );
  const [tab, setTab] = useState<RosterStatus>("pending");
  const [notice, setNotice] = useState<string | null>(null);
  const visible = rows.filter((row) => row.status === tab);

  function decide(id: string, status: "approved" | "rejected") {
    const row = rows.find((item) => item.id === id);
    setRows((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              status,
              approvedBy: status === "approved" ? "You (preview)" : null,
              approvedAt: status === "approved" ? new Date().toISOString() : null,
            }
          : item,
      ),
    );
    setNotice(row ? `${labelOf(status)} ${row.showName}.` : null);
  }

  return (
    <MockupPage
      kicker="Roster requests"
      title="Roster requests"
      lede="An imported or claimed link waits here. Approve makes it a live roster link in this preview. Reject keeps the row."
      wide
    >
      <div role="tablist" aria-label="Request status" className="flex flex-wrap gap-2">
        {TABS.map((status) => {
          const count = rows.filter((row) => row.status === status).length;
          return (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={tab === status}
              className={tab === status ? primaryButtonClass : ghostButtonClass}
              style={mockupRadius}
              onClick={() => setTab(status)}
            >
              {labelOf(status)} ({count})
            </button>
          );
        })}
      </div>
      {notice ? (
        <p className={`mt-4 ${mockupMuted}`} role="status">
          {notice}
        </p>
      ) : null}
      {visible.length === 0 ? (
        <p className={`mt-6 ${mockupMuted}`}>No {labelOf(tab).toLowerCase()} roster requests.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {visible.map((row) => (
            <li key={row.id} className={mockupCard} style={mockupRadius}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{row.showName}</p>
                  <p className={mockupMuted}>
                    {row.agentName} · {labelOf(row.source)}
                  </p>
                  <p className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusPill>{labelOf(row.status)}</StatusPill>
                    <ExclusiveMark on={row.isExclusive} />
                  </p>
                  {row.approvedAt ? (
                    <p className={`mt-2 ${mockupMuted}`}>
                      Approved by {row.approvedBy} on {formatDay(row.approvedAt)}.
                    </p>
                  ) : null}
                </div>
                {row.status === "pending" ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={primaryButtonClass}
                      style={mockupRadius}
                      onClick={() => decide(row.id, "approved")}
                    >
                      Approve {row.showName}
                    </button>
                    <button
                      type="button"
                      className={ghostButtonClass}
                      style={mockupRadius}
                      onClick={() => decide(row.id, "rejected")}
                    >
                      Reject {row.showName}
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </MockupPage>
  );
}
