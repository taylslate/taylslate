"use client";

// Brand reviews a make-good on the deal. The show can read it.
// Approval stays in the app: no DocuSign, no charge.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { MakeGoodOptionId, MakeGoodRecord } from "@/lib/make-goods/types";

interface Props {
  dealId: string;
  /** Server-loaded rows. Omit on surfaces that should not fetch. */
  proposals?: MakeGoodRecord[];
  canApprove?: boolean;
  /** Legacy deal view loads the list itself. */
  autoload?: boolean;
}

const panelClass = "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const inkText = "text-[var(--ts-ink-on-paper)]";
const radiusStyle = { borderRadius: "var(--ts-radius)" };
const ghostBtnClass =
  "inline-flex items-center justify-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)] disabled:cursor-not-allowed disabled:opacity-50";
const inkBtnClass =
  "inline-flex items-center justify-center bg-[var(--ts-ink-on-paper)] px-3 py-2 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

function kindLabel(kind: MakeGoodRecord["kind"]): string {
  return kind === "missed" ? "Missed spot" : "Short delivery";
}

export default function MakeGoodPanel({
  dealId,
  proposals,
  canApprove = false,
  autoload = false,
}: Props) {
  const router = useRouter();
  const seeded = proposals !== undefined;
  const [rows, setRows] = useState<MakeGoodRecord[] | null>(seeded ? proposals : null);
  const [brandCanApprove, setBrandCanApprove] = useState(canApprove);
  const [choice, setChoice] = useState<Record<string, MakeGoodOptionId>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!seeded) return;
    setRows(proposals);
    setBrandCanApprove(canApprove);
  }, [seeded, proposals, canApprove]);

  useEffect(() => {
    if (!autoload || seeded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/make-goods`);
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as {
          can_approve?: boolean;
          make_goods?: MakeGoodRecord[];
        };
        if (cancelled) return;
        setRows(body.make_goods ?? []);
        setBrandCanApprove(body.can_approve === true);
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoload, dealId, seeded]);

  if (!autoload && !seeded) return null;
  if (!rows) return null;
  if (!brandCanApprove && rows.length === 0) return null;

  async function checkDelivery() {
    setBusy("check");
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/make-goods`, { method: "POST" });
      const body = (await res.json()) as {
        error?: string;
        can_approve?: boolean;
        make_goods?: MakeGoodRecord[];
      };
      if (!res.ok) {
        setError(body.error ?? "Could not check delivery.");
        return;
      }
      setRows(body.make_goods ?? []);
      if (typeof body.can_approve === "boolean") setBrandCanApprove(body.can_approve);
      router.refresh();
    } catch {
      setError("Could not check delivery.");
    } finally {
      setBusy(null);
    }
  }

  async function decide(row: MakeGoodRecord, action: "approve" | "decline") {
    const option = choice[row.id] ?? row.options[0]?.id;
    if (action === "approve" && !option) return;
    setBusy(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/make-goods/${row.id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: action === "approve" ? JSON.stringify({ option }) : undefined,
      });
      const body = (await res.json()) as { error?: string; make_good?: MakeGoodRecord };
      if (!res.ok || !body.make_good) {
        setError(body.error ?? "Could not save the decision.");
        return;
      }
      setRows((current) =>
        (current ?? []).map((item) => (item.id === body.make_good!.id ? body.make_good! : item))
      );
      router.refresh();
    } catch {
      setError("Could not save the decision.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`p-5 ${panelClass}`} style={radiusStyle}>
      <h2 className={`mb-3 text-xs font-medium uppercase tracking-wider ${mutedText}`}>
        Make-good
      </h2>
      {brandCanApprove && (
        <button
          type="button"
          onClick={checkDelivery}
          disabled={busy !== null}
          className={ghostBtnClass}
          style={radiusStyle}
        >
          {busy === "check" ? "Checking…" : "Check airchecks"}
        </button>
      )}
      {rows.length === 0 && (
        <p className={`mt-3 text-sm ${mutedText}`}>
          No missed or short spot is open on this deal.
        </p>
      )}
      <div className="mt-4 space-y-4">
        {rows.map((row) => {
          const selected = choice[row.id] ?? row.options[0]?.id;
          return (
            <article key={row.id} className="border-t border-[var(--ts-hairline-on-paper)] pt-4">
              <p className={`text-sm font-medium ${inkText}`}>
                {kindLabel(row.kind)} · {row.show_name}
              </p>
              <p className={`mt-1 text-sm ${mutedText}`}>
                {row.placement} on {row.post_date}. {row.reason}
              </p>
              {row.status === "proposed" && brandCanApprove && (
                <fieldset className="mt-3 space-y-2">
                  <legend className={`text-xs uppercase tracking-wider ${mutedText}`}>
                    Remedy
                  </legend>
                  {row.options.map((option) => (
                    <label key={option.id} className={`flex items-start gap-2 text-sm ${inkText}`}>
                      <input
                        type="radio"
                        name={`make-good-${row.id}`}
                        className="mt-1"
                        checked={selected === option.id}
                        onChange={() =>
                          setChoice((current) => ({ ...current, [row.id]: option.id }))
                        }
                      />
                      <span>
                        <span className="font-medium">{option.label}</span>
                        <span className={`mt-0.5 block ${mutedText}`}>{option.summary}</span>
                      </span>
                    </label>
                  ))}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      className={inkBtnClass}
                      style={radiusStyle}
                      disabled={busy !== null}
                      onClick={() => decide(row, "approve")}
                    >
                      {busy === row.id ? "Saving…" : `Approve ${row.options.find((option) => option.id === selected)?.label ?? "make-good"}`}
                    </button>
                    <button
                      type="button"
                      className={ghostBtnClass}
                      style={radiusStyle}
                      disabled={busy !== null}
                      onClick={() => decide(row, "decline")}
                    >
                      Decline make-good
                    </button>
                  </div>
                </fieldset>
              )}
              {row.status === "proposed" && !brandCanApprove && (
                <p className={`mt-2 text-sm ${mutedText}`}>Waiting on the brand.</p>
              )}
              {row.status !== "proposed" && (
                <div className="mt-3">
                  <p className={`text-sm font-medium ${inkText}`}>
                    {row.status === "approved" ? "Approved" : "Declined"}
                    {row.delivery_state === "scheduled" ? " · replacement scheduled" : ""}
                    {row.delivery_state === "credited" ? " · credit recorded" : ""}
                  </p>
                  {row.status === "approved" && (
                    <pre className={`mt-2 whitespace-pre-wrap font-sans text-sm ${inkText}`}>
                      {row.amended_terms}
                    </pre>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {error && <p className="mt-3 text-sm text-[var(--ts-accent)]">{error}</p>}
      <p className={`mt-3 text-xs ${mutedText}`}>
        Approval stays in Taylslate. It does not send a signature request and it does not charge.
      </p>
    </div>
  );
}
