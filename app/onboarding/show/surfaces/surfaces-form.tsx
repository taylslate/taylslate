"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";
import SurfaceEditor from "@/components/shows/SurfaceEditor";
import {
  sanitizeShowSurfaceDrafts,
  type SellableSurface,
  type ShowSurfaceDraft,
} from "@/lib/shows/surfaces";

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

export default function SurfacesForm({ initial }: { initial: SellableSurface[] }) {
  const [drafts, setDrafts] = useState<ShowSurfaceDraft[]>(initial.map(toDraft));

  return (
    <OnboardingShell
      slug="surfaces"
      title="What else can a brand buy with the show?"
      subtitle="Optional. A newsletter, social clip, or community mention is an add-on on this show, bought on the same insertion order. Skip this if the read is the whole offer."
      onContinue={async () => {
        const res = await fetch("/api/show-surfaces", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ surfaces: sanitizeShowSurfaceDrafts(drafts) }),
        });
        if (!res.ok) return false;
        return null;
      }}
    >
      <SurfaceEditor drafts={drafts} onChange={setDrafts} />
      <p className="mt-4 border-t border-[var(--ts-hairline-on-paper)] pt-4 text-xs text-[var(--ts-ink-muted-on-paper)]">
        A suggested minimum is guidance for the brand. It does not block a smaller buy. You can edit this later in settings.
      </p>
    </OnboardingShell>
  );
}
