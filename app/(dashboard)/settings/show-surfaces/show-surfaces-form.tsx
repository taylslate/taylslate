"use client";

import { useState } from "react";
import Link from "next/link";
import SurfaceEditor from "@/components/shows/SurfaceEditor";
import { tokens } from "@/lib/brand/tokens";
import {
  sanitizeShowSurfaceDrafts,
  type SellableSurface,
  type ShowSurfaceDraft,
} from "@/lib/shows/surfaces";

const radiusStyle = { borderRadius: tokens.radius };

function toDraft(surface: SellableSurface): ShowSurfaceDraft {
  return {
    type: surface.type,
    audience_size: surface.audience_size,
    format: surface.format,
    min_buy: surface.min_buy,
    creative_constraints: surface.creative_constraints,
    lead_time_days: surface.lead_time_days,
    posting_owner: surface.posting_owner,
    price: surface.price,
    notes: surface.notes,
    published: surface.published,
  };
}

export default function ShowSurfacesSettingsForm({ initial }: { initial: SellableSurface[] }) {
  const [drafts, setDrafts] = useState<ShowSurfaceDraft[]>(initial.map(toDraft));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/show-surfaces", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ surfaces: sanitizeShowSurfaceDrafts(drafts) }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Couldn't save surfaces");
      return;
    }
    setSaved(true);
  };

  return (
    <div className="max-w-2xl p-4 sm:p-8">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]">
        For shows
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--ts-ink-on-paper)]">
        Sellable surfaces
      </h1>
      <p className="mb-8 mt-1 text-sm text-[var(--ts-ink-muted-on-paper)]">
        Newsletter, social, and community mentions a brand can add to the same insertion order as the show. They are add-ons, not a separate media plan.
      </p>
      <SurfaceEditor drafts={drafts} onChange={setDrafts} />
      {error && (
        <p className="mt-4 text-sm text-[var(--ts-accent-text)]" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="mt-4 text-sm text-[var(--ts-ink-on-paper)]">Saved.</p>
      )}
      <div className="mt-8 flex items-center justify-between">
        <Link
          href="/settings"
          className="text-sm text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
        >
          Back to settings
        </Link>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="bg-[var(--ts-accent)] px-4 py-2 text-sm font-medium text-[var(--ts-accent-foreground)] hover:opacity-90 disabled:opacity-50"
          style={radiusStyle}
        >
          {saving ? "Saving…" : "Save surfaces"}
        </button>
      </div>
    </div>
  );
}
