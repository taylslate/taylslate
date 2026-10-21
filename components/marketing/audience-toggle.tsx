"use client";

import { useRef, useState } from "react";
import { SlateClap } from "@/components/marketing/slate-clap";
import type { MarketingGuest } from "@/lib/marketing/guest";

const CLAP_MS = 300;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function AudienceToggle() {
  const [guest, setGuest] = useState<MarketingGuest>("brands");
  const [clapping, setClapping] = useState(false);
  const busy = useRef(false);
  const nextGuest: MarketingGuest = guest === "brands" ? "shows" : "brands";

  async function select(target: MarketingGuest) {
    if (busy.current || target === guest) return;
    busy.current = true;
    const reduced = prefersReducedMotion();
    if (!reduced) {
      setClapping(true);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, CLAP_MS);
      });
      setClapping(false);
    }
    setGuest(target);
    if (target === "shows") {
      document.getElementById("shows")?.scrollIntoView({
        behavior: reduced ? "auto" : "smooth",
        block: "start",
      });
    } else {
      window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    }
    busy.current = false;
  }

  const labelClass = (active: boolean) =>
    active
      ? "text-[var(--ts-accent-text)]"
      : "text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]";

  return (
    <div className="mb-6 flex justify-center">
      <div
        className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] sm:gap-3"
        role="group"
        aria-label="Audience"
      >
        <button
          type="button"
          className={labelClass(guest === "brands")}
          aria-pressed={guest === "brands"}
          onClick={() => void select("brands")}
        >
          For brands
        </button>
        <SlateClap
          clapping={clapping}
          nextGuest={nextGuest}
          onToggle={() => {
            void select(nextGuest);
          }}
        />
        <button
          type="button"
          className={labelClass(guest === "shows")}
          aria-pressed={guest === "shows"}
          onClick={() => void select("shows")}
        >
          For shows
        </button>
      </div>
    </div>
  );
}
