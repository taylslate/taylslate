"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";
import type { ShowBrandHistoryEntry } from "@/lib/data/types";

const MAX_ROWS = 5; // soft UI limit; server backstops at 10

interface EntryDraft {
  brand_name: string;
  category: string;
  deal_type: "" | "one-off" | "annual";
  notes: string;
}

function toDraft(entry: ShowBrandHistoryEntry): EntryDraft {
  return {
    brand_name: entry.brand_name ?? "",
    category: entry.category ?? "",
    deal_type: entry.deal_type ?? "",
    notes: entry.notes ?? "",
  };
}

const EMPTY_DRAFT: EntryDraft = { brand_name: "", category: "", deal_type: "", notes: "" };

/** Mirror the server sanitizer: drop blank-brand rows, omit empty optional fields. */
function clean(drafts: EntryDraft[]): ShowBrandHistoryEntry[] {
  const out: ShowBrandHistoryEntry[] = [];
  for (const d of drafts) {
    const brand_name = d.brand_name.trim();
    if (!brand_name) continue;
    const entry: ShowBrandHistoryEntry = { brand_name };
    const category = d.category.trim();
    if (category) entry.category = category;
    const notes = d.notes.trim();
    if (notes) entry.notes = notes;
    if (d.deal_type) entry.deal_type = d.deal_type;
    out.push(entry);
  }
  return out;
}

const inputClass =
  "w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-[var(--brand-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all";

export default function BrandHistoryForm({ initialValue }: { initialValue: ShowBrandHistoryEntry[] }) {
  const [drafts, setDrafts] = useState<EntryDraft[]>(
    initialValue.length > 0 ? initialValue.map(toDraft) : [{ ...EMPTY_DRAFT }]
  );

  const update = (index: number, patch: Partial<EntryDraft>) =>
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  const addRow = () => setDrafts((prev) => (prev.length >= MAX_ROWS ? prev : [...prev, { ...EMPTY_DRAFT }]));

  const removeRow = (index: number) =>
    setDrafts((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length > 0 ? next : [{ ...EMPTY_DRAFT }];
    });

  return (
    <OnboardingShell
      slug="brand-history"
      title="Which brands have advertised with you?"
      subtitle="Optional — your advertiser history helps us match you with the right brands. Add a few, or skip."
      onContinue={async () => ({ brand_history: clean(drafts) })}
    >
      <div className="space-y-4">
        {drafts.map((d, index) => (
          <div
            key={index}
            className="rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--brand-text-muted)] uppercase tracking-wider">
                Advertiser {index + 1}
              </span>
              {drafts.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  aria-label={`Remove advertiser ${index + 1}`}
                  className="p-1.5 rounded-lg text-[var(--brand-text-muted)] hover:text-[var(--brand-error)] hover:bg-[var(--brand-error)]/[0.06] transition-all"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            <input
              type="text"
              value={d.brand_name}
              onChange={(e) => update(index, { brand_name: e.target.value })}
              placeholder="Brand name (e.g. Athletic Greens)"
              className={inputClass}
            />

            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={d.category}
                onChange={(e) => update(index, { category: e.target.value })}
                placeholder="Category (optional)"
                className={inputClass}
              />
              <select
                value={d.deal_type}
                onChange={(e) => update(index, { deal_type: e.target.value as EntryDraft["deal_type"] })}
                className={inputClass}
              >
                <option value="">Deal type (optional)</option>
                <option value="one-off">One-off</option>
                <option value="annual">Annual deal</option>
              </select>
            </div>

            <input
              type="text"
              value={d.notes}
              onChange={(e) => update(index, { notes: e.target.value })}
              placeholder="Notes (optional) — e.g. renewed twice, great fit"
              className={inputClass}
            />
          </div>
        ))}

        {drafts.length < MAX_ROWS && (
          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-1.5 text-sm text-[var(--brand-blue)] hover:text-[var(--brand-blue-light)] font-medium transition-colors"
          >
            + Add another advertiser
          </button>
        )}

        <p className="text-xs text-[var(--brand-text-muted)] border-t border-[var(--brand-border)] pt-4">
          Leave blank and continue if you&apos;d rather skip. You can add these later in settings.
        </p>
      </div>
    </OnboardingShell>
  );
}
