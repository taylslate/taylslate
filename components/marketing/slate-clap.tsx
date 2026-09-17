import type { MarketingGuest } from "@/lib/marketing/guest";

export function SlateClap({
  clapping,
  nextGuest,
  onToggle,
}: {
  clapping: boolean;
  nextGuest: MarketingGuest;
  onToggle: () => void;
}) {
  const label =
    nextGuest === "shows" ? "Switch to shows" : "Switch to brands";

  return (
    <button
      type="button"
      className={`ts-clap inline-flex h-11 w-11 items-center justify-center text-[var(--ts-ink-on-paper)] ${
        clapping ? "is-clapping" : ""
      }`}
      aria-label={label}
      onClick={onToggle}
    >
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
        <g className="ts-clap-stick">
          <rect x="5" y="9" width="22" height="5" rx="0.6" fill="currentColor" />
          <rect
            x="9"
            y="9"
            width="2.4"
            height="5"
            fill="var(--ts-accent)"
          />
          <rect
            x="14.5"
            y="9"
            width="2.4"
            height="5"
            fill="var(--ts-accent)"
          />
          <rect
            x="20"
            y="9"
            width="2.4"
            height="5"
            fill="var(--ts-accent)"
          />
        </g>
        <rect
          x="5"
          y="14.5"
          width="22"
          height="13"
          rx="1.2"
          fill="currentColor"
        />
        <rect
          x="7.2"
          y="17.2"
          width="17.6"
          height="8"
          fill="var(--ts-paper)"
        />
      </svg>
    </button>
  );
}
