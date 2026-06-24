"use client";

// Wave 14 Phase 2B Layer 5 — discovery view.
//
// Renders the conviction-scored show universe for a v2 (2A-interpreted)
// campaign: shows grouped by confirmed ring (primary first), each card showing
// the composite + conviction band, the three sub-scores, and the reasoning
// prose. Filter (don't prune) by ring and by band; per-ring pagination. This is
// the "more results, not fewer" surface — the test/scale split is 2C, not here.
//
// TRIGGER: the discover POST runs 3-6 concurrent LLM calls (Layer 4) and is
// slow, so it gets a real loading state. On first landing (rings confirmed, no
// scores, discovery never ran) the view auto-fires it once; afterwards a manual
// "Re-run discovery" affordance reruns it. The fire is guarded by a SYNCHRONOUS
// in-flight latch (inFlightRef) — set before the await so two concurrent
// triggers (the auto-fire effect + a manual click, or a StrictMode double
// effect invoke) cannot both spend the 3-6 LLM calls. A useState flag would not
// be concurrent-safe: both callers would read the stale `false` before React
// committed the update. (Cross-mount concurrency — a hard reload mid-run in a
// second tab — is out of this latch's reach; see the note on runDiscovery.)
//
// HONEST-LAUNCH RENDER (matches the Layer 2/4 reality, not the score numbers):
//   - Audience fit is rendered "Unmeasured" GLOBALLY for 2B. Every discovered
//     show has empty demographics and every ring carries no structured target,
//     so Layer 2 scores audience a neutral degraded 50 for all of them. The
//     conviction_scores row persists only the number, not the degraded flag, so
//     the view cannot tell a real 50 from an unmeasured 50 per-row — and at
//     launch it is provably unmeasured for 100% of shows. We therefore do NOT
//     render a (fake) audience bar. Flip AUDIENCE_MEASURED to true (and read a
//     persisted per-dimension measured flag) when demographics enrichment ships.
//   - Bands cap at `medium` by construction (audience pinned at 50 makes the
//     high band's convergence guard effectively unreachable). Medium is the
//     natural ceiling; the UI never frames the absence of `high` as a problem.

import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import type { ConvictionBand, Show } from "@/lib/data/types";
import type {
  ConvictionUniverse,
  ConvictionUniverseGroup,
  ConvictionUniverseShow,
} from "@/lib/data/reasoning-log";

// ---- Honest-launch flags ----

/** Audience fit is unmeasured for every show at launch (empty demographics, no
 *  structured ring target). Flip to true when a persisted per-dimension
 *  measured flag lands, and read it per-row instead of rendering globally. */
const AUDIENCE_MEASURED = false;

/** Per-ring rows shown before the "Show more" affordance. Filter, don't prune. */
const PAGE_SIZE = 25;

// ---- Band display ----

const BAND_META: Record<
  ConvictionBand,
  { label: string; badge: string; dot: string }
> = {
  high: {
    label: "High conviction",
    badge: "bg-[var(--brand-success)]/10 text-[var(--brand-success)]",
    dot: "bg-[var(--brand-success)]",
  },
  medium: {
    label: "Medium conviction",
    badge: "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]",
    dot: "bg-[var(--brand-blue)]",
  },
  low: {
    label: "Worth a test slot",
    badge: "bg-[var(--brand-warning)]/10 text-[var(--brand-warning)]",
    dot: "bg-[var(--brand-warning)]",
  },
  speculative: {
    label: "Speculative",
    badge: "bg-[var(--brand-text-muted)]/12 text-[var(--brand-text-muted)]",
    dot: "bg-[var(--brand-text-muted)]",
  },
};

const BAND_ORDER: ConvictionBand[] = ["high", "medium", "low", "speculative"];

// ---- Brand safety (§11 — surface a notice, NEVER a score penalty) ----

interface BrandSafetyFlag {
  level: string;
  note?: string;
}

/**
 * Read a brand-safety flag off a show. The persisted `shows` table carries no
 * brand-safety field today, so this returns null at runtime in 2B and the
 * notice is inert — built render-ready so it lights up when enrichment persists
 * a flag, with NO change to scoring (§11: fit is the platform's call, brand
 * values are the brand's). The notice never modifies a score.
 */
function readBrandSafety(show: Show | null): BrandSafetyFlag | null {
  if (!show) return null;
  const raw = (show as unknown as { brand_safety?: unknown }).brand_safety;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const level = typeof obj.level === "string" ? obj.level : null;
  if (!level || level === "none") return null;
  return { level, note: typeof obj.note === "string" ? obj.note : undefined };
}

// ---- Props ----

interface ConvictionDiscoveryViewProps {
  campaignId: string;
  campaignName: string;
  budgetTotal: number | null;
  universe: ConvictionUniverse;
  /** True once a `conviction.scored` domain event exists for this campaign —
   *  i.e. discovery has run at least once, even if it kept zero shows. Gates
   *  the auto-fire so a genuinely empty result does not re-fire on every load
   *  (hasScores alone can't tell "never ran" from "ran, found nothing"). */
  discoveryRan: boolean;
}

type RingFilter = "all" | string;
type BandFilter = "all" | ConvictionBand;

// ---- Component ----

export default function ConvictionDiscoveryView({
  campaignId,
  campaignName,
  budgetTotal,
  universe,
  discoveryRan,
}: ConvictionDiscoveryViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  // Soft "another run owns the lock" notice (409 from the server-side discovery
  // mutex) — distinct from a hard error: nothing is wrong, another tab/run is
  // mid-flight, so we never re-fire (that would just 409 again).
  const [discoverNotice, setDiscoverNotice] = useState<string | null>(null);
  // Synchronous concurrent-fire latch — see file header. Reset only after the
  // POST settles, never in an effect cleanup (so a StrictMode remount can't
  // re-fire).
  const inFlightRef = useRef(false);
  // Once-per-mount auto-fire guard. The inFlightRef latch stops *concurrent*
  // fires; this stops a *sequential* re-fire if the auto-fire effect re-runs
  // (e.g. a dep identity churns) after the first POST already settled. Auto-fire
  // is a once-per-visit action; the manual "Re-run discovery" button is the
  // explicit re-trigger and is NOT gated by this.
  const autoFiredRef = useRef(false);

  const runDiscovery = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setDiscovering(true);
    setDiscoverError(null);
    setDiscoverNotice(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/discover`, {
        method: "POST",
      });
      // 409: the server-side mutex says another run owns discovery for this
      // campaign right now (a second tab, or a reload mid-run). The duplicate
      // spend was already prevented server-side; surface a soft notice and do
      // NOT re-fire. The user refreshes once the other run lands.
      if (res.status === 409) {
        setDiscoverNotice(
          "Discovery is already running for this campaign — it may be open in another tab. It'll appear here once that run finishes."
        );
        return;
      }
      if (!res.ok) {
        let msg = "Discovery couldn't finish. Try again.";
        try {
          const body = await res.json();
          if (body?.error && typeof body.error === "string") msg = body.error;
        } catch {
          /* non-JSON error body — keep the default message */
        }
        setDiscoverError(msg);
        return;
      }
      // Re-read the server component so the persisted scores render (or the
      // ran-but-empty state shows). router.refresh keeps this component mounted;
      // isPending bridges the window so there's no flash back to "loading".
      startTransition(() => router.refresh());
    } catch {
      setDiscoverError("Network error reaching discovery. Try again.");
    } finally {
      inFlightRef.current = false;
      setDiscovering(false);
    }
  }, [campaignId, router]);

  // Auto-fire once on first landing: rings confirmed, nothing scored, discovery
  // never ran. The inFlightRef latch makes a StrictMode double-invoke safe.
  useEffect(() => {
    if (universe.hasScores) return;
    if (universe.rings.length === 0) return;
    if (discoveryRan) return;
    if (autoFiredRef.current) return;
    autoFiredRef.current = true;
    runDiscovery();
  }, [universe.hasScores, universe.rings.length, discoveryRan, runDiscovery]);

  // ---- Not-yet-scored states ----

  if (universe.rings.length === 0) {
    return (
      <Shell campaignId={campaignId} campaignName={campaignName} router={router}>
        <CenteredState
          title="Confirm an interpretation first"
          body="Discovery scores against your confirmed rings. Head back to the interpretation step to confirm one."
        />
      </Shell>
    );
  }

  if (!universe.hasScores) {
    // Explicit phase ordering (each checked before the next):
    //   1. actively running / refreshing → loading
    //   2. 409 notice → another run owns discovery; soft, no re-fire
    //   3. hard error → retry
    //   4. ran but kept nothing → empty (no re-fire)
    //   5. otherwise → pre-fire frame; the auto-fire effect is about to run
    const body = (() => {
      if (discovering || isPending) {
        return <DiscoveringState ringCount={universe.rings.length} />;
      }
      if (discoverNotice) {
        return (
          <CenteredState
            title="Discovery is already running"
            body={discoverNotice}
            action={{ label: "Refresh", onClick: () => router.refresh() }}
          />
        );
      }
      if (discoverError) {
        return (
          <CenteredState
            title="Discovery didn't complete"
            body={discoverError}
            action={{ label: "Try again", onClick: runDiscovery }}
          />
        );
      }
      if (discoveryRan) {
        return (
          <CenteredState
            title="No shows cleared the bar for these rings"
            body="Discovery ran but found no shows at medium conviction or above for your confirmed rings. Refine the interpretation to widen the rings, or re-run discovery."
            action={{ label: "Re-run discovery", onClick: runDiscovery }}
          />
        );
      }
      return <DiscoveringState ringCount={universe.rings.length} />;
    })();
    return (
      <Shell campaignId={campaignId} campaignName={campaignName} router={router}>
        {body}
      </Shell>
    );
  }

  // ---- Scored universe ----
  return (
    <ScoredUniverse
      campaignId={campaignId}
      campaignName={campaignName}
      budgetTotal={budgetTotal}
      universe={universe}
      onRerun={runDiscovery}
      rerunning={discovering || isPending}
      router={router}
    />
  );
}

// ============================================================
// Scored universe (filters + grouped list)
// ============================================================

function ScoredUniverse({
  campaignId,
  campaignName,
  budgetTotal,
  universe,
  onRerun,
  rerunning,
  router,
}: {
  campaignId: string;
  campaignName: string;
  budgetTotal: number | null;
  universe: ConvictionUniverse;
  onRerun: () => void;
  rerunning: boolean;
  router: ReturnType<typeof useRouter>;
}) {
  const [ringFilter, setRingFilter] = useState<RingFilter>("all");
  const [bandFilter, setBandFilter] = useState<BandFilter>("all");
  const [pageByRing, setPageByRing] = useState<Record<string, number>>({});

  const totalShows = useMemo(
    () => universe.groups.reduce((n, g) => n + g.shows.length, 0),
    [universe.groups]
  );

  // Bands actually present — drives which band chips render. Medium-as-ceiling:
  // we never render a `high` chip nobody can select, which would read as
  // "something's missing".
  const presentBands = useMemo(() => {
    const seen = new Set<ConvictionBand>();
    for (const g of universe.groups) {
      for (const s of g.shows) {
        if (s.score.conviction_band) seen.add(s.score.conviction_band);
      }
    }
    return BAND_ORDER.filter((b) => seen.has(b));
  }, [universe.groups]);

  const allSpeculative =
    totalShows > 0 &&
    presentBands.length === 1 &&
    presentBands[0] === "speculative";

  // Apply ring + band filters (filter, don't prune the underlying universe).
  const visibleGroups = useMemo(() => {
    return universe.groups
      .filter((g) => ringFilter === "all" || g.ring.id === ringFilter)
      .map((g) => ({
        group: g,
        shows:
          bandFilter === "all"
            ? g.shows
            : g.shows.filter((s) => s.score.conviction_band === bandFilter),
      }));
  }, [universe.groups, ringFilter, bandFilter]);

  const visibleCount = visibleGroups.reduce((n, g) => n + g.shows.length, 0);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* ---- Header ---- */}
      <div className="px-8 pt-6 pb-4 border-b border-[var(--brand-border)] bg-[var(--brand-surface-elevated)]">
        <div className="flex items-center gap-3 mb-1">
          <BackButton router={router} />
          <h1 className="text-xl font-bold text-[var(--brand-text)] tracking-tight">
            {campaignName}
          </h1>
          <button
            onClick={onRerun}
            disabled={rerunning}
            className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-[var(--brand-border)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-blue)]/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {rerunning ? "Re-running…" : "Re-run discovery"}
          </button>
        </div>
        <div className="flex items-center gap-4 text-sm text-[var(--brand-text-secondary)]">
          {budgetTotal != null && (
            <span>{formatCurrency(budgetTotal)} budget</span>
          )}
          <span className="text-[var(--brand-text-muted)]">
            {totalShows} {totalShows === 1 ? "show" : "shows"} across{" "}
            {universe.rings.length}{" "}
            {universe.rings.length === 1 ? "ring" : "rings"}
          </span>
          <span className="text-[var(--brand-text-muted)]">
            This is everything we found — filter and pick.
          </span>
        </div>
      </div>

      {/* ---- Filters ---- */}
      <div className="px-8 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[var(--brand-border)] bg-[var(--brand-surface)]">
        {/* Ring filter */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <span className="text-xs text-[var(--brand-text-muted)] shrink-0">
            Ring
          </span>
          <FilterChip
            active={ringFilter === "all"}
            onClick={() => setRingFilter("all")}
            label={`All (${universe.rings.length})`}
          />
          {universe.groups.map((g) => (
            <FilterChip
              key={g.ring.id}
              active={ringFilter === g.ring.id}
              onClick={() =>
                setRingFilter(ringFilter === g.ring.id ? "all" : g.ring.id)
              }
              label={`${g.ring.label} (${g.shows.length})`}
            />
          ))}
        </div>

        {/* Band filter — only bands that are present */}
        {presentBands.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--brand-text-muted)] shrink-0">
              Conviction
            </span>
            <FilterChip
              active={bandFilter === "all"}
              onClick={() => setBandFilter("all")}
              label="All"
            />
            {presentBands.map((b) => (
              <FilterChip
                key={b}
                active={bandFilter === b}
                onClick={() => setBandFilter(bandFilter === b ? "all" : b)}
                label={BAND_META[b].label}
                dot={BAND_META[b].dot}
              />
            ))}
          </div>
        )}
      </div>

      {/* ---- Grouped list ---- */}
      <div className="flex-1 overflow-y-auto px-8 py-4">
        {allSpeculative && (
          <div className="mb-4 px-4 py-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-sm text-[var(--brand-text-secondary)]">
            These rings are still speculative — defensible hypotheses, not proven
            fits. Treat this list as exploration to pressure-test, not a
            ready-to-buy plan.
          </div>
        )}

        {visibleCount === 0 ? (
          <CenteredState
            title="Nothing matches this filter"
            body="Clear a filter to see the rest of the universe."
          />
        ) : (
          <div className="space-y-8">
            {visibleGroups.map(({ group, shows }) => {
              if (shows.length === 0) return null;
              const page = pageByRing[group.ring.id] ?? 1;
              const limit = PAGE_SIZE * page;
              const shown = shows.slice(0, limit);
              const remaining = shows.length - shown.length;
              return (
                <section key={group.ring.id} data-testid="ring-group">
                  <RingHeading group={group} shownCount={shows.length} />
                  <div className="space-y-2 mt-3">
                    {shown.map((entry) => (
                      <ShowCard key={entry.score.id} entry={entry} />
                    ))}
                  </div>
                  {remaining > 0 && (
                    <button
                      onClick={() =>
                        setPageByRing((prev) => ({
                          ...prev,
                          [group.ring.id]: page + 1,
                        }))
                      }
                      className="mt-3 text-xs text-[var(--brand-blue)] hover:underline"
                    >
                      Show {Math.min(remaining, PAGE_SIZE)} more in this ring
                    </button>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* ---- Footer CTA ---- */}
      <div className="px-8 py-4 border-t border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] flex items-center">
        <span className="text-xs text-[var(--brand-text-muted)]">
          Conviction scoring · audience fit is unmeasured at launch and shown as
          such.
        </span>
        <button
          onClick={() => router.push(`/campaigns/${campaignId}/plan`)}
          className="ml-auto px-6 py-2.5 rounded-xl bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-semibold transition-all"
        >
          Build media plan
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Ring heading
// ============================================================

const RING_KIND_LABEL: Record<string, string> = {
  primary: "Primary read",
  lateral: "Lateral ring",
  confirmed: "Confirmed ring",
  added_by_brand: "Added by you",
};

function RingHeading({
  group,
  shownCount,
}: {
  group: ConvictionUniverseGroup;
  shownCount: number;
}) {
  const kindLabel =
    group.ring.brand_decision === "added_by_brand"
      ? RING_KIND_LABEL.added_by_brand
      : RING_KIND_LABEL[group.ring.kind] ?? "Ring";
  return (
    <div className="flex items-baseline gap-3">
      <h2 className="text-base font-semibold text-[var(--brand-text)]">
        {group.ring.label}
      </h2>
      <span className="text-[11px] uppercase tracking-wide text-[var(--brand-text-muted)]">
        {kindLabel}
      </span>
      <span className="text-xs text-[var(--brand-text-muted)]">
        {shownCount} {shownCount === 1 ? "show" : "shows"}
      </span>
    </div>
  );
}

// ============================================================
// Show card
// ============================================================

function ShowCard({ entry }: { entry: ConvictionUniverseShow }) {
  const { score, show } = entry;
  const band = score.conviction_band ?? "low";
  const meta = BAND_META[band];
  const safety = readBrandSafety(show);
  const name = show?.name ?? "Show unavailable";
  const categories = (show?.categories ?? []).slice(0, 4);

  return (
    <div
      data-testid="show-card"
      className="px-4 py-3.5 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)]"
    >
      <div className="flex items-start gap-4">
        {/* Image / initials */}
        <div className="w-10 h-10 rounded-lg flex-shrink-0 overflow-hidden bg-gradient-to-br from-[var(--brand-blue)]/20 to-[var(--brand-teal)]/20 flex items-center justify-center">
          {show?.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={show.image_url}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-xs font-bold text-[var(--brand-blue)]">
              {name.slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>

        {/* Name + categories */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[var(--brand-text)] truncate">
              {name}
            </span>
            <span
              data-testid="band-badge"
              className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${meta.badge}`}
            >
              {meta.label}
            </span>
          </div>
          {categories.length > 0 && (
            <div className="text-xs text-[var(--brand-text-muted)] truncate mt-0.5">
              {categories.join(" · ")}
            </div>
          )}
        </div>

        {/* Composite */}
        <div className="text-right flex-shrink-0">
          <div
            data-testid="composite-score"
            className="text-2xl font-bold text-[var(--brand-text)] leading-none"
          >
            {score.composite_score ?? "—"}
          </div>
          <div className="text-[10px] text-[var(--brand-text-muted)] mt-1">
            composite
          </div>
        </div>
      </div>

      {/* Three sub-scores — the brand must see the dimensions diverge */}
      <div className="grid grid-cols-3 gap-4 mt-3">
        <SubScore
          label="Audience fit"
          value={AUDIENCE_MEASURED ? score.audience_fit_score : null}
          unmeasured={!AUDIENCE_MEASURED}
          accent="bg-[var(--brand-text-muted)]"
        />
        <SubScore
          label="Topical relevance"
          value={score.topical_relevance_score}
          accent="bg-[var(--brand-blue)]"
        />
        <SubScore
          label="Purchase power"
          value={score.purchase_power_score}
          accent="bg-[var(--brand-teal)]"
        />
      </div>

      {/* Reasoning prose (LLM or templated fallback — same render path) */}
      {score.reasoning && (
        <p className="text-sm text-[var(--brand-text-secondary)] mt-3 leading-snug">
          {score.reasoning}
        </p>
      )}

      {/* Brand-safety notice (§11 — informational only, never a score penalty) */}
      {safety && <BrandSafetyNotice flag={safety} />}
    </div>
  );
}

function SubScore({
  label,
  value,
  unmeasured,
  accent,
}: {
  label: string;
  value?: number | null;
  unmeasured?: boolean;
  accent: string;
}) {
  return (
    <div data-testid="sub-score" data-dimension={label}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-[var(--brand-text-muted)]">
          {label}
        </span>
        {unmeasured ? (
          <span className="text-[11px] font-medium text-[var(--brand-text-muted)] italic">
            Unmeasured
          </span>
        ) : (
          <span className="text-[11px] font-semibold text-[var(--brand-text)]">
            {value ?? "—"}
          </span>
        )}
      </div>
      <div className="h-1.5 rounded-full bg-[var(--brand-border)] overflow-hidden">
        {unmeasured ? (
          // No bar for an unmeasured dimension — a dashed track, not a fake fill.
          <div className="h-full w-full bg-[repeating-linear-gradient(90deg,var(--brand-border)_0,var(--brand-border)_4px,transparent_4px,transparent_8px)]" />
        ) : (
          <div
            className={`h-full rounded-full ${accent}`}
            style={{ width: `${clampPct(value)}%` }}
          />
        )}
      </div>
    </div>
  );
}

function BrandSafetyNotice({ flag }: { flag: BrandSafetyFlag }) {
  return (
    <div
      data-testid="brand-safety-notice"
      role="note"
      className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg border border-[var(--brand-warning)]/30 bg-[var(--brand-warning)]/[0.06]"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--brand-warning)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 flex-shrink-0"
      >
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div className="text-xs text-[var(--brand-text-secondary)]">
        <span className="font-medium text-[var(--brand-text)]">
          Brand-safety flag ({flag.level}).
        </span>{" "}
        {flag.note ?? "Review whether this show fits your brand values."} This is
        informational — it does not affect the conviction score.
      </div>
    </div>
  );
}

// ============================================================
// Not-yet-scored states + shared chrome
// ============================================================

function Shell({
  campaignId,
  campaignName,
  router,
  children,
}: {
  campaignId: string;
  campaignName: string;
  router: ReturnType<typeof useRouter>;
  children: React.ReactNode;
}) {
  void campaignId;
  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <div className="px-8 pt-6 pb-4 border-b border-[var(--brand-border)] bg-[var(--brand-surface-elevated)]">
        <div className="flex items-center gap-3">
          <BackButton router={router} />
          <h1 className="text-xl font-bold text-[var(--brand-text)] tracking-tight">
            {campaignName}
          </h1>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function DiscoveringState({ ringCount }: { ringCount: number }) {
  return (
    <div
      data-testid="discovering-state"
      className="flex flex-col items-center justify-center h-full gap-4 text-center px-8"
    >
      <div className="w-10 h-10 rounded-full border-2 border-[var(--brand-blue)]/30 border-t-[var(--brand-blue)] animate-spin" />
      <div>
        <p className="text-base font-semibold text-[var(--brand-text)]">
          Scoring the show universe…
        </p>
        <p className="text-sm text-[var(--brand-text-secondary)] mt-1 max-w-md">
          Reasoning across {ringCount} {ringCount === 1 ? "ring" : "rings"} —
          this takes ~30–60 seconds. You can stay here; it’ll fill in
          automatically.
        </p>
      </div>
    </div>
  );
}

function CenteredState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8 py-20">
      <p className="text-base font-semibold text-[var(--brand-text)]">{title}</p>
      <p className="text-sm text-[var(--brand-text-secondary)] max-w-md">
        {body}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-2 px-5 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-all"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// ============================================================
// Small shared bits
// ============================================================

function FilterChip({
  active,
  onClick,
  label,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  dot?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5 ${
        active
          ? "bg-[var(--brand-blue)] text-white"
          : "bg-[var(--brand-surface-elevated)] border border-[var(--brand-border)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-blue)]/40"
      }`}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${active ? "bg-white" : dot}`}
        />
      )}
      {label}
    </button>
  );
}

function BackButton({ router }: { router: ReturnType<typeof useRouter> }) {
  return (
    <button
      onClick={() => router.push("/campaigns")}
      aria-label="Back to campaigns"
      className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
    </button>
  );
}

function clampPct(n?: number | null): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return `$${n.toLocaleString()}`;
}
