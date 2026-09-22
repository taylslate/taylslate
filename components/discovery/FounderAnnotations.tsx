"use client";

// Wave 14 Phase 2D Layer 1 — founder annotations, inline on discovery cards.
//
// Admin-only ("Chris") free-text reasoning a show's metadata can't infer
// ("host personally uses cold plunge", "wrong-ring — more faith-based than it
// looks"). This is moat / learning signal: captured here, fed into future ring
// location. Brands never see it.
//
// The discovery view is one big client tree, and the cards are nested four
// levels deep (view → tiered → section → card). Rather than prop-drill
// `isAdmin` + the annotation map through every layer, we pass them once into a
// context Provider wrapping the scored universe, and each card drops in a single
// <ShowAnnotations showId={...} />. Non-admins get null.

import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { tokens } from "@/lib/brand/tokens";
import type { FounderAnnotationRow } from "@/lib/data/types";

const radiusStyle = { borderRadius: tokens.radius };

interface FounderAnnotationsContextValue {
  isAdmin: boolean;
  annotationsByShow: Record<string, FounderAnnotationRow[]>;
}

const FounderAnnotationsContext = createContext<FounderAnnotationsContextValue>({
  isAdmin: false,
  annotationsByShow: {},
});

export function FounderAnnotationsProvider({
  isAdmin,
  annotationsByShow,
  children,
}: FounderAnnotationsContextValue & { children: React.ReactNode }) {
  return (
    <FounderAnnotationsContext.Provider value={{ isAdmin, annotationsByShow }}>
      {children}
    </FounderAnnotationsContext.Provider>
  );
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

/**
 * Inline founder-annotation affordance for one show. Renders null for
 * non-admins. A TestShowCard wraps its content in a <label>, so any click here
 * would otherwise toggle that card's checkbox — the root stops propagation.
 */
export function ShowAnnotations({ showId }: { showId: string }) {
  const { isAdmin, annotationsByShow } = useContext(FounderAnnotationsContext);
  const router = useRouter();

  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isAdmin) return null;

  const annotations = annotationsByShow[showId] ?? [];

  async function save() {
    const trimmed = note.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      const res = await fetch(`/api/admin/shows/${showId}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: trimmed, tags }),
      });
      if (!res.ok) {
        setError("Couldn't save the note. Try again.");
        return;
      }
      setNote("");
      setTagsInput("");
      setAdding(false);
      router.refresh();
    } catch {
      setError("Network error saving the note.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (deletingId) return;
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/annotations/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError("Couldn't delete the note. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error deleting the note.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div
      data-testid="founder-annotations"
      // This block lives inside TestShowCard's <label>. A bare stopPropagation
      // does NOT cancel the label's default checkbox activation for clicks on
      // static text/header here (the label is the activationTarget) — only
      // preventDefault sets the event's canceled flag and skips it. Buttons here
      // are type="button" and input focus happens on mousedown, so cancelling
      // the click's default action doesn't break the form. Both: no toggle, no
      // bubble.
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className="mt-3 border-t border-[var(--ts-hairline-on-paper)] pt-3"
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ts-accent)]">
          Founder notes
        </span>
        {annotations.length > 0 && (
          <span className="text-[10px] text-[var(--ts-ink-muted-on-paper)]">
            {annotations.length}
          </span>
        )}
      </div>

      {annotations.length > 0 && (
        <ul className="space-y-1.5 mb-2">
          {annotations.map((a) => (
            <li
              key={a.id}
              className="flex items-start gap-2 text-xs text-[var(--ts-ink-muted-on-paper)]"
            >
              <div className="flex-1 min-w-0">
                <span className="leading-snug text-[var(--ts-ink-on-paper)]">{a.note}</span>
                {a.tags && a.tags.length > 0 && (
                  <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
                    {a.tags.map((t) => (
                      <span
                        key={t}
                        className="border border-[var(--ts-hairline-on-paper)] px-1.5 py-0.5 text-[10px] text-[var(--ts-ink-muted-on-paper)]"
                        style={radiusStyle}
                      >
                        {t}
                      </span>
                    ))}
                  </span>
                )}
                {fmtDate(a.created_at) && (
                  <span className="ml-1.5 text-[10px] text-[var(--ts-ink-muted-on-paper)]">
                    {fmtDate(a.created_at)}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(a.id)}
                disabled={deletingId === a.id}
                aria-label="Delete note"
                className="shrink-0 text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)] disabled:opacity-40"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="space-y-1.5">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this show is right (or wrong-ring)…"
            rows={2}
            className="w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-2.5 py-1.5 text-xs text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none"
            style={radiusStyle}
          />
          <input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="tags, comma, separated (optional)"
            className="w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-2.5 py-1.5 text-xs text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none"
            style={radiusStyle}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!note.trim() || busy}
              className="bg-[var(--ts-ink-on-paper)] px-3 py-1.5 text-xs font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:opacity-40"
              style={radiusStyle}
            >
              {busy ? "Saving…" : "Save note"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setNote("");
                setTagsInput("");
                setError(null);
              }}
              className="text-xs text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-xs font-medium text-[var(--ts-accent)] hover:underline"
        >
          + Add note
        </button>
      )}

      {error && (
        <div className="mt-1 text-[10px] text-[var(--ts-ink-on-paper)]">{error}</div>
      )}
    </div>
  );
}
