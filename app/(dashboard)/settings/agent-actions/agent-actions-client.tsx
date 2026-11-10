"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { tokens } from "@/lib/brand/tokens";

interface ListedAction {
  id: string;
  kind: "campaign.create" | "outreach.draft";
  status: "pending" | "approved" | "rejected" | "expired";
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
  executed_at: string | null;
  result_campaign_id: string | null;
  execution_error: string | null;
  key: { name: string | null; prefix: string | null };
  summary: ActionSummary;
}

type ActionSummary =
  | {
      type: "campaign";
      brand_name: string | null;
      budget_total: number | null;
      goals: string | null;
      flight: string | null;
    }
  | {
      type: "outreach";
      show_name: string | null;
      subject: string | null;
      body: string | null;
    };

const TABS = ["pending", "approved", "rejected", "expired"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL: Record<Tab, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
};

const radiusStyle = { borderRadius: tokens.radius };
const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-sm text-[var(--ts-ink-muted-on-paper)]";
const panelClass = "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-4";
const inkBtnClass =
  "inline-flex items-center bg-[var(--ts-accent)] px-4 py-2 text-sm font-medium text-[var(--ts-accent-foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const ghostBtnClass =
  "inline-flex items-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)] disabled:cursor-not-allowed disabled:opacity-50";
const fieldClass =
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";
const kickerClass =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ListResponse {
  data?: ListedAction[];
  next_cursor?: string | null;
  error?: string;
}

interface DecisionResponse {
  action?: ListedAction;
  message?: string;
  error?: string;
}

export default function AgentActionsClient() {
  const [tab, setTab] = useState<Tab>("pending");
  const [rows, setRows] = useState<ListedAction[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeHref, setNoticeHref] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; decision: "approve" | "reject" } | null>(
    null
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (status: Tab, next: string | null, append: boolean) => {
    setLoading(true);
    setLoadError(null);
    const params = new URLSearchParams({ status });
    if (next) params.set("cursor", next);
    try {
      const response = await fetch(`/api/settings/agent-actions?${params.toString()}`);
      const body = (await response.json()) as ListResponse;
      if (!response.ok) {
        setLoadError(typeof body.error === "string" ? body.error : "Could not load actions.");
        if (!append) setRows([]);
        return;
      }
      const data = Array.isArray(body.data) ? body.data : [];
      setRows((current) => (append ? mergeRows(current, data) : data));
      setCursor(typeof body.next_cursor === "string" ? body.next_cursor : null);
    } catch {
      setLoadError("Could not load actions.");
      if (!append) setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab, null, false);
  }, [load, tab]);

  async function submit(id: string, decision: "approve" | "reject" | "retry", decisionNote: string) {
    setBusy(true);
    setNotice(null);
    setNoticeHref(null);
    try {
      const payload: { decision: string; note?: string } = { decision };
      const trimmed = decisionNote.trim();
      if (trimmed) payload.note = trimmed;
      const response = await fetch(`/api/settings/agent-actions/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as DecisionResponse;
      if (!response.ok) {
        setNotice(typeof body.error === "string" ? body.error : "Could not save the decision.");
        if (body.action?.status && body.action.status !== tab) {
          setTab(asTab(body.action.status));
        } else {
          await load(tab, null, false);
        }
        return;
      }
      setNotice(typeof body.message === "string" ? body.message : "Saved.");
      const campaignId = body.action?.result_campaign_id;
      if (campaignId && UUID_RE.test(campaignId)) {
        setNoticeHref(`/campaigns/${campaignId}`);
      }
      setConfirm(null);
      setNote("");
      const nextTab = body.action?.status ? asTab(body.action.status) : tab;
      if (nextTab !== tab) setTab(nextTab);
      else await load(tab, null, false);
    } catch {
      setNotice("Could not save the decision.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl p-4 sm:p-8">
      <p className={kickerClass}>For brands</p>
      <h1 className={`mt-2 text-2xl font-semibold tracking-tight ${inkText}`}>Agent actions</h1>
      <p className={`mb-6 mt-1 ${mutedText}`}>
        Actions your API keys propose wait here until you approve or reject them.
      </p>

      <div role="tablist" aria-label="Approval status" className="flex flex-wrap gap-2">
        {TABS.map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={tab === status}
            className={tab === status ? inkBtnClass : ghostBtnClass}
            style={radiusStyle}
            onClick={() => {
              setConfirm(null);
              setTab(status);
            }}
          >
            {TAB_LABEL[status]}
          </button>
        ))}
      </div>

      {notice ? (
        <p className={`mt-4 ${mutedText}`} role="status">
          {notice}{" "}
          {noticeHref ? (
            <Link href={noticeHref} className="text-[var(--ts-accent-text)]">
              Open campaign
            </Link>
          ) : null}
        </p>
      ) : null}
      {loadError ? (
        <p className={`mt-4 ${mutedText}`} role="alert">
          {loadError}
        </p>
      ) : null}

      {loading && rows.length === 0 ? (
        <p className={`mt-6 ${mutedText}`}>Loading.</p>
      ) : rows.length === 0 && !loadError ? (
        <p className={`mt-6 ${mutedText}`}>
          {tab === "pending"
            ? "Nothing waiting. Actions your API keys propose show up here for you to approve."
            : `No ${TAB_LABEL[tab].toLowerCase()} actions.`}
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {rows.map((row) => (
            <ActionRow
              key={row.id}
              row={row}
              confirm={confirm?.id === row.id ? confirm.decision : null}
              note={confirm?.id === row.id ? note : ""}
              busy={busy}
              onNote={setNote}
              onStart={(decision) => {
                setConfirm({ id: row.id, decision });
                setNote("");
              }}
              onCancel={() => {
                setConfirm(null);
                setNote("");
              }}
              onConfirm={(decision) => void submit(row.id, decision, note)}
              onRetry={() => void submit(row.id, "retry", "")}
            />
          ))}
        </ul>
      )}

      {cursor ? (
        <button
          type="button"
          className={`mt-4 ${ghostBtnClass}`}
          style={radiusStyle}
          disabled={loading || busy}
          onClick={() => void load(tab, cursor, true)}
        >
          Load more
        </button>
      ) : null}
    </div>
  );
}

function ActionRow({
  row,
  confirm,
  note,
  busy,
  onNote,
  onStart,
  onCancel,
  onConfirm,
  onRetry,
}: {
  row: ListedAction;
  confirm: "approve" | "reject" | null;
  note: string;
  busy: boolean;
  onNote: (value: string) => void;
  onStart: (decision: "approve" | "reject") => void;
  onCancel: () => void;
  onConfirm: (decision: "approve" | "reject") => void;
  onRetry: () => void;
}) {
  const label = kindLabel(row.kind);
  const campaignId =
    row.result_campaign_id && UUID_RE.test(row.result_campaign_id)
      ? row.result_campaign_id
      : null;
  return (
    <li className={panelClass} style={radiusStyle}>
      <p className={`font-medium ${inkText}`}>{label}</p>
      <p className={`mt-1 ${mutedText}`}>
        {row.key.name ?? "Unnamed key"}
        {row.key.prefix ? ` · ${row.key.prefix}` : ""}
      </p>
      <p className={`mt-1 ${mutedText}`}>Requested {formatWhen(row.created_at)}</p>
      <Summary summary={row.summary} />
      {row.decision_note ? <p className={`mt-2 ${mutedText}`}>{row.decision_note}</p> : null}
      {row.kind === "outreach.draft" && row.status === "approved" ? (
        <p className={`mt-2 ${inkText}`}>Approved. Nothing was sent.</p>
      ) : null}
      {row.execution_error ? (
        <p className={`mt-2 ${mutedText}`} role="alert">
          {row.execution_error}
        </p>
      ) : null}
      {campaignId ? (
        <p className="mt-2">
          <Link href={`/campaigns/${campaignId}`} className="text-[var(--ts-accent-text)]">
            Open campaign
          </Link>
        </p>
      ) : null}
      {row.status === "pending" && confirm === null ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={inkBtnClass}
            style={radiusStyle}
            aria-label={`Approve ${label}`}
            disabled={busy}
            onClick={() => onStart("approve")}
          >
            Approve
          </button>
          <button
            type="button"
            className={ghostBtnClass}
            style={radiusStyle}
            aria-label={`Reject ${label}`}
            disabled={busy}
            onClick={() => onStart("reject")}
          >
            Reject
          </button>
        </div>
      ) : null}
      {confirm ? (
        <div className="mt-3">
          <label className={`mb-1.5 block text-sm font-medium ${inkText}`} htmlFor={`note-${row.id}`}>
            Note (optional)
          </label>
          <textarea
            id={`note-${row.id}`}
            value={note}
            maxLength={500}
            rows={3}
            className={fieldClass}
            style={radiusStyle}
            onChange={(event) => onNote(event.target.value)}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={inkBtnClass}
              style={radiusStyle}
              disabled={busy}
              onClick={() => onConfirm(confirm)}
            >
              {confirm === "approve" ? "Confirm approval" : "Confirm rejection"}
            </button>
            <button
              type="button"
              className={ghostBtnClass}
              style={radiusStyle}
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {row.execution_error && !campaignId && row.status === "approved" ? (
        <button
          type="button"
          className={`mt-3 ${ghostBtnClass}`}
          style={radiusStyle}
          disabled={busy}
          onClick={onRetry}
        >
          Retry
        </button>
      ) : null}
    </li>
  );
}

function Summary({ summary }: { summary: ActionSummary }) {
  if (summary.type === "outreach") {
    return (
      <div className="mt-2">
        <p className={inkText}>{summary.show_name ?? "Show unavailable"}</p>
        <p className={`mt-1 ${inkText}`}>{summary.subject ?? ""}</p>
        {summary.body ? (
          <details className="mt-2">
            <summary className={mutedText}>Draft</summary>
            <p className={`mt-2 whitespace-pre-wrap ${inkText}`}>{summary.body}</p>
          </details>
        ) : null}
      </div>
    );
  }
  return (
    <div className={`mt-2 ${inkText}`}>
      <p>{summary.brand_name ?? "Brand name not set"}</p>
      <p className="mt-1">{formatBudget(summary.budget_total)}</p>
      <p className="mt-1">{summary.goals ?? "No goals"}</p>
      <p className="mt-1">{summary.flight ?? "No flight"}</p>
    </div>
  );
}

function kindLabel(kind: ListedAction["kind"]): string {
  return kind === "outreach.draft" ? "Outreach draft" : "Campaign brief";
}

function formatWhen(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatBudget(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "Budget not set";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function asTab(status: string): Tab {
  if (status === "approved" || status === "rejected" || status === "expired") return status;
  return "pending";
}

function mergeRows(current: ListedAction[], next: ListedAction[]): ListedAction[] {
  const seen = new Set(current.map((row) => row.id));
  return current.concat(next.filter((row) => !seen.has(row.id)));
}
