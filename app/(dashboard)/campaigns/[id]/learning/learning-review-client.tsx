"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LearningReview } from "@/lib/learning/review";
import { LearningReviewView } from "./learning-review-view";

interface Named {
  id: string;
  label: string;
}

interface DealOption {
  dealId: string;
  showName: string;
  reportedConversions: number | null;
  reportable: boolean;
}

const field =
  "mt-1 w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)]";
const radius = { borderRadius: "var(--ts-radius)" };
const button =
  "bg-[var(--ts-ink-on-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-paper)] disabled:opacity-60";

export function LearningReviewClient({
  campaignId,
  campaignName,
  review,
  canReport,
  canNote,
  shows,
  rings,
  styles,
  deals,
}: {
  campaignId: string;
  campaignName: string;
  review: LearningReview;
  canReport: boolean;
  canNote: boolean;
  shows: Named[];
  rings: Named[];
  styles: Named[];
  deals: DealOption[];
}) {
  return (
    <>
      <LearningReviewView
        campaignId={campaignId}
        campaignName={campaignName}
        review={review}
      />
      {review.ready && (canReport || canNote) && (
        <div className="bg-[var(--ts-paper)] px-4 pb-16 text-[var(--ts-ink-on-paper)] sm:px-8">
          <div className="mx-auto max-w-3xl space-y-10">
            {canReport && deals.some((deal) => deal.reportable) && (
              <ConversionForms campaignId={campaignId} deals={deals.filter((deal) => deal.reportable)} />
            )}
            {canNote && (
              <OverrideForm
                campaignId={campaignId}
                shows={shows}
                rings={rings}
                styles={styles}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ConversionForms({
  campaignId,
  deals,
}: {
  campaignId: string;
  deals: DealOption[];
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold">Report conversions</h2>
      <p className="mt-1 text-sm text-[var(--ts-ink-muted-on-paper)]">
        Type the count you actually have. Leave it blank if you don&apos;t — a blank is not zero.
      </p>
      <ul className="mt-4 space-y-4">
        {deals.map((deal) => (
          <li key={deal.dealId}>
            <ConversionForm campaignId={campaignId} deal={deal} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConversionForm({
  campaignId,
  deal,
}: {
  campaignId: string;
  deal: DealOption;
}) {
  const router = useRouter();
  const [value, setValue] = useState(
    deal.reportedConversions == null ? "" : String(deal.reportedConversions)
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(conversions: number | null) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/learning/conversions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: deal.dealId, conversions }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Couldn't save that count.");
        return;
      }
      if (conversions == null) setValue("");
      router.refresh();
    } catch {
      setError("Couldn't save that count.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="border border-[var(--ts-hairline-on-paper)] px-4 py-3"
      style={radius}
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) {
          setError("Type a whole number, or clear the saved count.");
          return;
        }
        const parsed = Number(trimmed);
        if (!Number.isInteger(parsed) || parsed < 0) {
          setError("Conversions must be a whole number.");
          return;
        }
        void save(parsed);
      }}
    >
      <label className="block text-sm font-medium" htmlFor={`conversions-${deal.dealId}`}>
        {deal.showName}
      </label>
      <input
        id={`conversions-${deal.dealId}`}
        inputMode="numeric"
        className={field}
        style={radius}
        value={value}
        placeholder="not enough data"
        onChange={(event) => setValue(event.target.value)}
      />
      {error && <p className="mt-2 text-sm text-[var(--ts-accent)]">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="submit" className={button} style={radius} disabled={pending}>
          Save count
        </button>
        {deal.reportedConversions != null && (
          <button
            type="button"
            className="border border-[var(--ts-hairline-on-paper)] px-4 py-2 text-sm"
            style={radius}
            disabled={pending}
            onClick={() => void save(null)}
          >
            Clear
          </button>
        )}
      </div>
    </form>
  );
}

function OverrideForm({
  campaignId,
  shows,
  rings,
  styles,
}: {
  campaignId: string;
  shows: Named[];
  rings: Named[];
  styles: Named[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState(shows.length > 0 ? "show" : rings.length > 0 ? "ring" : "style");
  const options = kind === "show" ? shows : kind === "ring" ? rings : styles;
  const [targetKey, setTargetKey] = useState(options[0]?.id ?? "");
  const [stance, setStance] = useState("test_next");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function changeKind(next: string) {
    setKind(next);
    const list = next === "show" ? shows : next === "ring" ? rings : styles;
    setTargetKey(list[0]?.id ?? "");
  }

  return (
    <section>
      <h2 className="text-lg font-semibold">Add a note</h2>
      <p className="mt-1 text-sm text-[var(--ts-ink-muted-on-paper)]">
        A note guides the next flight. It does not drop a show.
      </p>
      <form
        className="mt-4 border border-[var(--ts-hairline-on-paper)] px-4 py-3"
        style={radius}
        onSubmit={(event) => {
          event.preventDefault();
          if (!note.trim()) {
            setError("A note is required.");
            return;
          }
          setPending(true);
          setError(null);
          void fetch(`/api/campaigns/${campaignId}/learning/overrides`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetKind: kind, targetKey, stance, note }),
          })
            .then(async (res) => {
              const body = (await res.json().catch(() => ({}))) as { error?: string };
              if (!res.ok) {
                setError(body.error ?? "Couldn't save that note.");
                return;
              }
              setNote("");
              router.refresh();
            })
            .catch(() => setError("Couldn't save that note."))
            .finally(() => setPending(false));
        }}
      >
        <label className="block text-sm font-medium" htmlFor="learning-kind">
          On
        </label>
        <select
          id="learning-kind"
          className={field}
          style={radius}
          value={kind}
          onChange={(event) => changeKind(event.target.value)}
        >
          {shows.length > 0 && <option value="show">Show</option>}
          {rings.length > 0 && <option value="ring">Audience ring</option>}
          <option value="style">Read style</option>
        </select>

        <label className="mt-3 block text-sm font-medium" htmlFor="learning-target">
          Which one
        </label>
        <select
          id="learning-target"
          className={field}
          style={radius}
          value={targetKey}
          onChange={(event) => setTargetKey(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>

        <label className="mt-3 block text-sm font-medium" htmlFor="learning-stance">
          Stance
        </label>
        <select
          id="learning-stance"
          className={field}
          style={radius}
          value={stance}
          onChange={(event) => setStance(event.target.value)}
        >
          <option value="renew">Renew</option>
          <option value="test_next">Test next</option>
          <option value="overweight">Overweight</option>
          <option value="avoid">Avoid</option>
          <option value="note">Note only</option>
        </select>

        <label className="mt-3 block text-sm font-medium" htmlFor="learning-note">
          Note
        </label>
        <textarea
          id="learning-note"
          className={field}
          style={radius}
          rows={3}
          value={note}
          placeholder="rep vouches, test one flight"
          onChange={(event) => setNote(event.target.value)}
        />
        {error && <p className="mt-2 text-sm text-[var(--ts-accent)]">{error}</p>}
        <button type="submit" className={`${button} mt-3`} style={radius} disabled={pending || !targetKey}>
          Save note
        </button>
      </form>
    </section>
  );
}
