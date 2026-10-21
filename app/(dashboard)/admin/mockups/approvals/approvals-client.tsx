"use client";

import { useState } from "react";
import { APPROVALS, formatDay, labelOf, type MockApproval } from "../fixtures";
import {
  MockupPage,
  StatusPill,
  ghostButtonClass,
  mockupCard,
  mockupMuted,
  mockupRadius,
  primaryButtonClass,
} from "../chrome";

type ApprovalStatus = MockApproval["status"];
const TABS: ApprovalStatus[] = ["pending", "approved", "rejected"];

export function ApprovalsClient() {
  const [rows, setRows] = useState<MockApproval[]>(() => APPROVALS.map((row) => ({ ...row })));
  const [tab, setTab] = useState<ApprovalStatus>("pending");
  const [notice, setNotice] = useState<string | null>(null);
  const visible = rows.filter((row) => row.status === tab);

  function decide(id: string, status: "approved" | "rejected") {
    const row = rows.find((item) => item.id === id);
    setRows((current) => current.map((item) => (item.id === id ? { ...item, status } : item)));
    setNotice(row ? `${labelOf(status)}: ${row.title}.` : null);
  }

  return (
    <MockupPage
      kicker="Approvals"
      title="Approvals"
      lede="Actions wait here until an admin approves or rejects them. Decisions stay in this preview."
    >
      <div role="tablist" aria-label="Approval status" className="flex flex-wrap gap-2">
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
        <p className={`mt-6 ${mockupMuted}`}>No {labelOf(tab).toLowerCase()} actions.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {visible.map((row) => (
            <li key={row.id} className={mockupCard} style={mockupRadius}>
              <p className="font-medium">{row.title}</p>
              <p className={`mt-1 ${mockupMuted}`}>{row.detail}</p>
              <p className={`mt-2 ${mockupMuted}`}>Requested {formatDay(row.requestedAt)}</p>
              <p className="mt-2">
                <StatusPill>{labelOf(row.status)}</StatusPill>
              </p>
              {row.status === "pending" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={primaryButtonClass}
                    style={mockupRadius}
                    aria-label={`Approve ${row.title}`}
                    onClick={() => decide(row.id, "approved")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className={ghostButtonClass}
                    style={mockupRadius}
                    aria-label={`Reject ${row.title}`}
                    onClick={() => decide(row.id, "rejected")}
                  >
                    Reject
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </MockupPage>
  );
}
