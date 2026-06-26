"use client";

// Wave 14 Phase 2C Layer 4 — dual-output discovery view.
//
// Renders the conviction-scored show universe for a v2 (2A-interpreted)
// campaign as the brand's actual shopping decision: a TEST PORTFOLIO (buy now,
// affordable at the 3-spot floor, selectable), a SCALE TIER (deferred — wanted
// but over the test budget; a curated watchlist), and a collapsed BENCH (Other
// matches). Tier is the primary grouping; ring + band become filters. Selecting
// ≥1 test show enables the "Media plan — next" CTA, which hands the selected
// test IDs to the legacy Wave 7 plan builder via campaigns.scored_shows /
// selected_show_ids (the plan-handoff adapter).
//
// The test/scale/bench split + per-show cost are computed upstream
// (lib/discovery/tiered-universe, Layers 1-3) and arrive as the `tiered` prop —
// this view READS them, never recomputes (2C is deterministic, no LLM here).
//
// TRIGGER: the discover POST runs 3-6 concurrent LLM calls (Layer 4 of 2B) and
// is slow, so it gets a real loading state. On first landing (rings confirmed,
// no scores, discovery never ran) the view auto-fires it once; afterwards a
// manual "Re-run discovery" affordance reruns it. The fire is guarded by a
// SYNCHRONOUS in-flight latch (inFlightRef) — set before the await so two
// concurrent triggers (the auto-fire effect + a manual click, or a StrictMode
// double effect invoke) cannot both spend the 3-6 LLM calls. A useState flag
// would not be concurrent-safe: both callers would read the stale `false`
// before React committed the update. (Cross-mount concurrency — a hard reload
// mid-run in a second tab — is out of this latch's reach; see runDiscovery.)
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
//   - Costs are ESTIMATES (banded CPM × downloads, or a default flat fee) and
//     the UI says so. Flat-fee (non-onboarded YouTube) shows a "quote to
//     confirm" range, never a precise price, and is excluded from the budget
//     meter's hard sum — the number is a placeholder, not a defensible quote.

import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import type {
  ConvictionBand,
  FounderAnnotationRow,
  RingHypothesisRow,
  Show,
} from "@/lib/data/types";
import type { ConvictionUniverse } from "@/lib/data/reasoning-log";
import type {
  TieredShow,
  TieredUniverse,
} from "@/lib/discovery/tiered-universe";
import type { Placement } from "@/lib/discovery/spot-cost";
import {
  FounderAnnotationsProvider,
  ShowAnnotations,
} from "@/components/discovery/FounderAnnotations";

// ---- Layer 5 override controls ----

/** Discovery placement vocabulary, with the labels the brand sees. */
const PLACEMENTS: { value: Placement; label: string }[] = [
  { value: "preroll", label: "Pre-roll" },
  { value: "midroll", label: "Mid-roll" },
  { value: "postroll", label: "Post-roll" },
];

/** Spot-count presets surfaced as a segmented control (the 3-spot floor is the
 *  default; 1 is the single-spot test; 2 fills the gap). */
const SPOT_COUNT_OPTIONS = [1, 2, 3];

const DEFAULT_SPOT_COUNT = 3;
const DEFAULT_PLACEMENT: Placement = "midroll";

/** One override request body — mirrors the portfolio-overrides endpoint. */
type OverrideBody =
  | { kind: "campaign_spot_count"; spotCount: number }
  | { kind: "campaign_placement"; placement: Placement }
  | { kind: "show_cpm"; showId: string; cpmDollars: number | null }
  | { kind: "show_placement"; showId: string; placement: Placement | null }
  | { kind: "reset" };

// ---- Honest-launch flags ----

/** Audience fit is unmeasured for every show at launch (empty demographics, no
 *  structured ring target). Flip to true when a persisted per-dimension
 *  measured flag lands, and read it per-row instead of rendering globally. */
const AUDIENCE_MEASURED = false;

/** Per-section rows shown before the "Show more" affordance. Filter, don't prune. */
const PAGE_SIZE = 25;

/** Fallback when a caller omits `tiered` — degrade to "nothing scored", never crash. */
const EMPTY_TIERED: TieredUniverse = {
  test: [],
  scale: [],
  bench: [],
  testBudgetCents: 0,
  testUnderfilled: true,
  hasScores: false,
};

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
  /** Phase 2C Layer 3: the test/scale/bench partitions + per-show cost the
   *  loader computed. Layer 4 renders this as the dual-output view (test
   *  portfolio / scale tier / bench). Optional + defaulted to an empty universe
   *  so a caller that omits it degrades to "nothing scored" rather than crashing. */
  tiered?: TieredUniverse;
  /** Phase 2C Layer 4: the brand's persisted test-cart selection
   *  (campaigns.selected_show_ids), so the cart reconstructs on reload instead
   *  of resetting to empty. */
  selectedShowIds?: string[];
  /** Phase 2C Layer 5: persisted campaign-level overrides, seeding the
   *  test-settings selectors. null ⇒ default (3 spots / mid-roll). */
  testSpotCount?: number | null;
  testPlacement?: Placement | null;
  /** Phase 2D Layer 1: true when the viewer is on the INTERNAL_ADMIN_EMAILS
   *  allowlist. Gates the founder-annotation affordance on every show card. */
  isAdmin?: boolean;
  /** Phase 2D Layer 1: founder annotations keyed by show id (admin-only; empty
   *  for brands). Threaded to the cards via FounderAnnotationsProvider. */
  annotationsByShow?: Record<string, FounderAnnotationRow[]>;
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
  tiered,
  selectedShowIds,
  testSpotCount,
  testPlacement,
  isAdmin = false,
  annotationsByShow = {},
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

  // ---- Scored universe (Phase 2C Layer 4 — tiered dual output) ----
  // The Provider threads isAdmin + annotations to the deeply-nested cards (Phase
  // 2D Layer 1) without prop-drilling through tiered/section/card layers.
  return (
    <FounderAnnotationsProvider
      isAdmin={isAdmin}
      annotationsByShow={annotationsByShow}
    >
      <TieredScoredUniverse
        campaignId={campaignId}
        campaignName={campaignName}
        budgetTotal={budgetTotal}
        tiered={tiered ?? EMPTY_TIERED}
        rings={universe.rings}
        initialSelectedShowIds={selectedShowIds ?? []}
        initialSpotCount={testSpotCount ?? DEFAULT_SPOT_COUNT}
        initialPlacement={testPlacement ?? DEFAULT_PLACEMENT}
        onRerun={runDiscovery}
        rerunning={discovering || isPending}
        router={router}
      />
    </FounderAnnotationsProvider>
  );
}

// ============================================================
// Tiered scored universe (test / scale / bench + budget meter + CTA)
// ============================================================

function TieredScoredUniverse({
  campaignId,
  campaignName,
  budgetTotal,
  tiered,
  rings,
  initialSelectedShowIds,
  initialSpotCount,
  initialPlacement,
  onRerun,
  rerunning,
  router,
}: {
  campaignId: string;
  campaignName: string;
  budgetTotal: number | null;
  tiered: TieredUniverse;
  rings: RingHypothesisRow[];
  initialSelectedShowIds: string[];
  initialSpotCount: number;
  initialPlacement: Placement;
  onRerun: () => void;
  rerunning: boolean;
  router: ReturnType<typeof useRouter>;
}) {
  const [, startRecompute] = useTransition();

  // ---- Layer 5 overrides: campaign spot-count + placement + reset ----
  // Local state seeds from props and re-syncs after a router.refresh re-reads
  // the persisted values (content signature dep, like the cart/watchlist state).
  const [spotCount, setSpotCount] = useState(initialSpotCount);
  const [placement, setPlacement] = useState<Placement>(initialPlacement);
  const [recomputing, setRecomputing] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  useEffect(() => {
    setSpotCount(initialSpotCount);
  }, [initialSpotCount]);
  useEffect(() => {
    setPlacement(initialPlacement);
  }, [initialPlacement]);

  const applyOverride = useCallback(
    async (body: OverrideBody) => {
      setRecomputing(true);
      setOverrideError(null);
      try {
        const res = await fetch(
          `/api/campaigns/${campaignId}/portfolio-overrides`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        if (!res.ok) {
          let m = "Couldn't apply that change. Try again.";
          try {
            const j = await res.json();
            if (j?.error && typeof j.error === "string") m = j.error;
          } catch {
            /* keep default */
          }
          setOverrideError(m);
          return false;
        }
        // A partial tier-cache persist means some shows may show a stale tier
        // until the next recompute — warn rather than silently refreshing into it.
        try {
          const j = await res.json();
          if (j?.cache_partial) {
            setOverrideError(
              "Some shows didn't fully update — re-apply to finish, or refresh."
            );
          }
        } catch {
          /* body optional; the refresh below still runs */
        }
        // Re-read the server component so the reshuffled tiers + persisted
        // override values render. Tiers can move a show between sections.
        startRecompute(() => router.refresh());
        return true;
      } catch {
        setOverrideError("Network error applying the change. Try again.");
        return false;
      } finally {
        setRecomputing(false);
      }
    },
    [campaignId, router]
  );

  const changeSpotCount = useCallback(
    (n: number) => {
      setSpotCount(n); // optimistic
      applyOverride({ kind: "campaign_spot_count", spotCount: n });
    },
    [applyOverride]
  );
  const changePlacement = useCallback(
    (p: Placement) => {
      setPlacement(p); // optimistic
      applyOverride({ kind: "campaign_placement", placement: p });
    },
    [applyOverride]
  );
  const resetOverrides = useCallback(() => {
    setSpotCount(DEFAULT_SPOT_COUNT);
    setPlacement(DEFAULT_PLACEMENT);
    applyOverride({ kind: "reset" });
  }, [applyOverride]);

  const overrideShowCpm = useCallback(
    (showId: string, cpmDollars: number | null) =>
      applyOverride({ kind: "show_cpm", showId, cpmDollars }),
    [applyOverride]
  );
  const overrideShowPlacement = useCallback(
    (showId: string, p: Placement) =>
      applyOverride({ kind: "show_placement", showId, placement: p }),
    [applyOverride]
  );

  const overridesActive =
    spotCount !== DEFAULT_SPOT_COUNT || placement !== DEFAULT_PLACEMENT;
  // Ring label by id — ring becomes a filter/sub-label now that tier is the
  // primary grouping. A TieredShow only carries ringHypothesisId.
  const ringLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rings) m.set(r.id, r.label);
    return m;
  }, [rings]);

  const allShows = useMemo(
    () => [...tiered.test, ...tiered.scale, ...tiered.bench],
    [tiered.test, tiered.scale, tiered.bench]
  );

  // ---- Filters (across all sections; filter, don't prune) ----
  const presentRings = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of allShows) {
      if (s.ringHypothesisId && ringLabelById.has(s.ringHypothesisId)) {
        seen.set(s.ringHypothesisId, ringLabelById.get(s.ringHypothesisId)!);
      }
    }
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [allShows, ringLabelById]);

  const presentBands = useMemo(() => {
    const seen = new Set<ConvictionBand>();
    for (const s of allShows) if (s.band) seen.add(s.band);
    return BAND_ORDER.filter((b) => seen.has(b));
  }, [allShows]);

  const [ringFilter, setRingFilter] = useState<RingFilter>("all");
  const [bandFilter, setBandFilter] = useState<BandFilter>("all");

  const matchesFilter = useCallback(
    (s: TieredShow) => {
      if (ringFilter !== "all" && s.ringHypothesisId !== ringFilter)
        return false;
      if (bandFilter !== "all" && s.band !== bandFilter) return false;
      return true;
    },
    [ringFilter, bandFilter]
  );

  // ---- Test-cart selection (durable: seeded + persisted) ----
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialSelectedShowIds)
  );
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistSelection = useCallback(
    (next: Set<string>) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        fetch("/api/campaigns/selections", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaign_id: campaignId,
            selected_show_ids: [...next],
          }),
        }).catch(() => {
          /* durability best-effort; the CTA writes authoritatively on handoff */
        });
      }, 800);
    },
    [campaignId]
  );

  const toggleSelect = useCallback(
    (showId: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(showId)) next.delete(showId);
        else next.add(showId);
        persistSelection(next);
        return next;
      });
    },
    [persistSelection]
  );

  // ---- Scale watchlist curation (saved / dismissed) ----
  const [savedIds, setSavedIds] = useState<Set<string>>(
    () => new Set(tiered.scale.filter((s) => s.brandSaved).map((s) => s.showId))
  );
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(
    () =>
      new Set(tiered.scale.filter((s) => s.brandDismissed).map((s) => s.showId))
  );
  const [showDismissed, setShowDismissed] = useState(false);

  // Resync local cart / watchlist state to the server truth when (and only
  // when) the persisted values actually change — i.e. after a router.refresh()
  // following a re-run discovery. These states seed from props once; without
  // this they'd go stale across a refresh (the component stays mounted). The
  // dependency is a CONTENT signature, not the array/object identity, so a local
  // toggle (which never changes the props) does not clobber the user's in-flight
  // selection — only a genuine server change resyncs.
  const selectionSig = useMemo(
    () => [...initialSelectedShowIds].sort().join("|"),
    [initialSelectedShowIds]
  );
  useEffect(() => {
    setSelectedIds(new Set(initialSelectedShowIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionSig]);

  const curationSig = useMemo(
    () =>
      tiered.scale
        .map((s) => `${s.showId}:${s.brandSaved ? 1 : 0}${s.brandDismissed ? 1 : 0}`)
        .join("|"),
    [tiered.scale]
  );
  useEffect(() => {
    setSavedIds(new Set(tiered.scale.filter((s) => s.brandSaved).map((s) => s.showId)));
    setDismissedIds(
      new Set(tiered.scale.filter((s) => s.brandDismissed).map((s) => s.showId))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curationSig]);

  const callWatchlist = useCallback(
    (showId: string, action: string) => {
      fetch(`/api/campaigns/${campaignId}/scale-watchlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showId, action }),
      }).catch(() => {
        /* watchlist is best-effort; local state already reflects the intent */
      });
    },
    [campaignId]
  );

  const toggleSave = useCallback(
    (showId: string) => {
      setSavedIds((prev) => {
        const next = new Set(prev);
        const willSave = !next.has(showId);
        if (willSave) next.add(showId);
        else next.delete(showId);
        callWatchlist(showId, willSave ? "save" : "unsave");
        if (willSave) {
          // Saving un-dismisses (mutually exclusive states).
          setDismissedIds((d) => {
            const nd = new Set(d);
            nd.delete(showId);
            return nd;
          });
        }
        return next;
      });
    },
    [callWatchlist]
  );

  const setDismiss = useCallback(
    (showId: string, dismiss: boolean) => {
      setDismissedIds((prev) => {
        const next = new Set(prev);
        if (dismiss) next.add(showId);
        else next.delete(showId);
        return next;
      });
      // Dismissing a (previously promoted) scale show must also pull it from
      // the test cart — otherwise it stays in the budget meter + CTA payload.
      if (dismiss) {
        setSelectedIds((prev) => {
          if (!prev.has(showId)) return prev;
          const next = new Set(prev);
          next.delete(showId);
          persistSelection(next);
          return next;
        });
      }
      callWatchlist(showId, dismiss ? "dismiss" : "restore");
    },
    [callWatchlist, persistSelection]
  );

  const promoteToTest = useCallback(
    (s: TieredShow) => {
      const cost = formatMoneyCents(s.threeSpotCents);
      const ok = window.confirm(
        `Move "${s.show?.name ?? "this show"}" into your test cart?\n\n` +
          `Its 3-spot cost (${cost}) is above the per-show test ceiling, so it ` +
          `will push your test spend up. You can fine-tune spots and placement ` +
          `in the media plan (single-spot tests land in a later step).`
      );
      if (!ok) return;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.add(s.showId);
        persistSelection(next);
        return next;
      });
      callWatchlist(s.showId, "promote");
    },
    [persistSelection, callWatchlist]
  );

  // ---- Budget meter (selected derived/rate_card 3-spot vs test budget) ----
  const selectedCostCents = useMemo(() => {
    let sum = 0;
    for (const s of allShows) {
      if (!selectedIds.has(s.showId)) continue;
      // flat_fee (untrusted) is shown but never summed; null basis can't price.
      if (s.costBasis !== "derived" && s.costBasis !== "rate_card") continue;
      if (s.threeSpotCents != null && Number.isFinite(s.threeSpotCents)) {
        sum += s.threeSpotCents;
      }
    }
    return sum;
  }, [allShows, selectedIds]);
  const overBudget =
    tiered.testBudgetCents > 0 && selectedCostCents > tiered.testBudgetCents;

  // ---- Media-plan handoff CTA ----
  const [handingOff, setHandingOff] = useState(false);
  const [ctaError, setCtaError] = useState<string | null>(null);
  const canBuild = selectedIds.size >= 1;

  const goToPlan = useCallback(async () => {
    if (!canBuild || handingOff) return;
    setHandingOff(true);
    setCtaError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/plan-handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showIds: [...selectedIds] }),
      });
      if (!res.ok) {
        setCtaError("Couldn't open the media plan. Try again.");
        return;
      }
      router.push(`/campaigns/${campaignId}/plan`);
    } catch {
      setCtaError("Network error reaching the media plan. Try again.");
    } finally {
      setHandingOff(false);
    }
  }, [campaignId, canBuild, handingOff, selectedIds, router]);

  // ---- Section lists (filtered) ----
  const visibleTest = useMemo(
    () => tiered.test.filter(matchesFilter),
    [tiered.test, matchesFilter]
  );
  const visibleScaleAll = useMemo(
    () => tiered.scale.filter(matchesFilter),
    [tiered.scale, matchesFilter]
  );
  const visibleScale = useMemo(
    () => visibleScaleAll.filter((s) => !dismissedIds.has(s.showId)),
    [visibleScaleAll, dismissedIds]
  );
  const dismissedScale = useMemo(
    () => visibleScaleAll.filter((s) => dismissedIds.has(s.showId)),
    [visibleScaleAll, dismissedIds]
  );
  const visibleBench = useMemo(
    () => tiered.bench.filter(matchesFilter),
    [tiered.bench, matchesFilter]
  );

  const totalShows = allShows.length;

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
            <span>{formatCurrency(budgetTotal)} test budget</span>
          )}
          <span className="text-[var(--brand-text-muted)]">
            {tiered.test.length} to test · {tiered.scale.length} to scale ·{" "}
            {tiered.bench.length} benched
          </span>
          <span className="text-[var(--brand-text-muted)]">
            Pick what to test now — save the rest for later.
          </span>
        </div>
      </div>

      {/* ---- Test settings (Layer 5 campaign-level overrides) ---- */}
      <TestSettingsBar
        spotCount={spotCount}
        placement={placement}
        onSpotCount={changeSpotCount}
        onPlacement={changePlacement}
        onReset={resetOverrides}
        overridesActive={overridesActive}
        recomputing={recomputing}
        error={overrideError}
      />

      {/* ---- Filters ---- */}
      {(presentRings.length > 0 || presentBands.length > 0) && (
        <div className="px-8 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[var(--brand-border)] bg-[var(--brand-surface)]">
          {presentRings.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
              <span className="text-xs text-[var(--brand-text-muted)] shrink-0">
                Ring
              </span>
              <FilterChip
                active={ringFilter === "all"}
                onClick={() => setRingFilter("all")}
                label="All"
              />
              {presentRings.map((r) => (
                <FilterChip
                  key={r.id}
                  active={ringFilter === r.id}
                  onClick={() =>
                    setRingFilter(ringFilter === r.id ? "all" : r.id)
                  }
                  label={r.label}
                />
              ))}
            </div>
          )}
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
      )}

      {/* ---- Sections ---- */}
      <div className="flex-1 overflow-y-auto px-8 py-5 space-y-8">
        {totalShows === 0 ? (
          <CenteredState
            title="No shows scored yet"
            body="Re-run discovery to score the universe against your confirmed rings."
          />
        ) : (
          <>
            {/* TEST PORTFOLIO (primary) */}
            <TestSection
              shows={visibleTest}
              underfilled={tiered.testUnderfilled}
              selectedIds={selectedIds}
              onToggle={toggleSelect}
              ringLabelById={ringLabelById}
              onCpmOverride={overrideShowCpm}
              onPlacementOverride={overrideShowPlacement}
              recomputing={recomputing}
            />

            {/* SCALE TIER (secondary) */}
            <ScaleSection
              shows={visibleScale}
              dismissed={dismissedScale}
              showDismissed={showDismissed}
              onToggleShowDismissed={() => setShowDismissed((v) => !v)}
              selectedIds={selectedIds}
              savedIds={savedIds}
              onPromote={promoteToTest}
              onRemoveFromCart={toggleSelect}
              onToggleSave={toggleSave}
              onDismiss={(id) => setDismiss(id, true)}
              onRestore={(id) => setDismiss(id, false)}
              ringLabelById={ringLabelById}
              onCpmOverride={overrideShowCpm}
              onPlacementOverride={overrideShowPlacement}
              recomputing={recomputing}
            />

            {/* BENCH (collapsed) */}
            <BenchSection shows={visibleBench} ringLabelById={ringLabelById} />
          </>
        )}
      </div>

      {/* ---- Footer: budget meter + CTA ---- */}
      <div className="px-8 py-4 border-t border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] flex items-center gap-6">
        <BudgetMeter
          spentCents={selectedCostCents}
          budgetCents={tiered.testBudgetCents}
          selectedCount={selectedIds.size}
          overBudget={overBudget}
        />
        <div className="ml-auto flex items-center gap-3">
          {ctaError && (
            <span className="text-xs text-[var(--brand-error)]">{ctaError}</span>
          )}
          <button
            type="button"
            onClick={goToPlan}
            disabled={!canBuild || handingOff}
            aria-label="Media plan — next"
            className="px-6 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 disabled:cursor-not-allowed disabled:bg-[var(--brand-border)]/40 disabled:text-[var(--brand-text-muted)] bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white"
          >
            {handingOff ? "Opening…" : "Media plan — next"}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Sections
// ============================================================

function TestSection({
  shows,
  underfilled,
  selectedIds,
  onToggle,
  ringLabelById,
  onCpmOverride,
  onPlacementOverride,
  recomputing,
}: {
  shows: TieredShow[];
  underfilled: boolean;
  selectedIds: Set<string>;
  onToggle: (showId: string) => void;
  ringLabelById: Map<string, string>;
  onCpmOverride: (showId: string, cpmDollars: number | null) => void;
  onPlacementOverride: (showId: string, placement: Placement) => void;
  recomputing: boolean;
}) {
  const [page, setPage] = useState(1);
  const shown = shows.slice(0, PAGE_SIZE * page);
  const remaining = shows.length - shown.length;

  return (
    <section data-testid="tier-test">
      <SectionHeading
        title="Test portfolio"
        sub="Buy now — affordable at the 3-spot test cadence."
        count={shows.length}
      />
      {underfilled ? (
        <div
          data-testid="test-underfilled"
          className="mt-3 px-4 py-3.5 rounded-xl border border-[var(--brand-warning)]/30 bg-[var(--brand-warning)]/[0.06] text-sm text-[var(--brand-text-secondary)]"
        >
          <span className="font-medium text-[var(--brand-text)]">
            Your budget is tight for a full 3-spot test.
          </span>{" "}
          Fewer than three shows fit three spots each within this budget. You can
          run a single-spot test across more shows, or raise the budget to open
          up the 3-spot cadence. Any test shows below are still selectable.
        </div>
      ) : null}
      {shows.length === 0 && !underfilled ? (
        <EmptySection note="No shows cleared the test bar for the current filters." />
      ) : (
        <div className="space-y-2 mt-3">
          {shown.map((s) => (
            <TestShowCard
              key={s.showId}
              entry={s}
              selected={selectedIds.has(s.showId)}
              onToggle={() => onToggle(s.showId)}
              ringLabel={
                s.ringHypothesisId
                  ? ringLabelById.get(s.ringHypothesisId) ?? null
                  : null
              }
              onCpmOverride={onCpmOverride}
              onPlacementOverride={onPlacementOverride}
              recomputing={recomputing}
            />
          ))}
        </div>
      )}
      {remaining > 0 && (
        <ShowMore remaining={remaining} onClick={() => setPage((p) => p + 1)} />
      )}
    </section>
  );
}

function ScaleSection({
  shows,
  dismissed,
  showDismissed,
  onToggleShowDismissed,
  selectedIds,
  savedIds,
  onPromote,
  onRemoveFromCart,
  onToggleSave,
  onDismiss,
  onRestore,
  ringLabelById,
  onCpmOverride,
  onPlacementOverride,
  recomputing,
}: {
  shows: TieredShow[];
  dismissed: TieredShow[];
  showDismissed: boolean;
  onToggleShowDismissed: () => void;
  selectedIds: Set<string>;
  savedIds: Set<string>;
  onPromote: (s: TieredShow) => void;
  onRemoveFromCart: (showId: string) => void;
  onToggleSave: (showId: string) => void;
  onDismiss: (showId: string) => void;
  onRestore: (showId: string) => void;
  ringLabelById: Map<string, string>;
  onCpmOverride: (showId: string, cpmDollars: number | null) => void;
  onPlacementOverride: (showId: string, placement: Placement) => void;
  recomputing: boolean;
}) {
  const [page, setPage] = useState(1);
  if (shows.length === 0 && dismissed.length === 0) return null;
  const shown = shows.slice(0, PAGE_SIZE * page);
  const remaining = shows.length - shown.length;

  return (
    <section data-testid="tier-scale">
      <SectionHeading
        title="Scale tier"
        sub="Deferred — fits a future budget. High intent, above the test ceiling."
        count={shows.length}
        muted
      />
      <div className="space-y-2 mt-3">
        {shown.map((s) => (
          <ScaleShowCard
            key={s.showId}
            entry={s}
            inCart={selectedIds.has(s.showId)}
            saved={savedIds.has(s.showId)}
            onPromote={() => onPromote(s)}
            onRemoveFromCart={() => onRemoveFromCart(s.showId)}
            onToggleSave={() => onToggleSave(s.showId)}
            onDismiss={() => onDismiss(s.showId)}
            ringLabel={
              s.ringHypothesisId
                ? ringLabelById.get(s.ringHypothesisId) ?? null
                : null
            }
            onCpmOverride={onCpmOverride}
            onPlacementOverride={onPlacementOverride}
            recomputing={recomputing}
          />
        ))}
      </div>
      {remaining > 0 && (
        <ShowMore remaining={remaining} onClick={() => setPage((p) => p + 1)} />
      )}
      {dismissed.length > 0 && (
        <div className="mt-3">
          <button
            onClick={onToggleShowDismissed}
            className="text-xs text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
          >
            {showDismissed ? "Hide" : "Show"} {dismissed.length} dismissed
          </button>
          {showDismissed && (
            <div className="space-y-2 mt-2 opacity-70">
              {dismissed.map((s) => (
                <div
                  key={s.showId}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-dashed border-[var(--brand-border)] bg-[var(--brand-surface)]"
                >
                  <span className="text-sm text-[var(--brand-text-secondary)] truncate flex-1">
                    {s.show?.name ?? "Show unavailable"}
                  </span>
                  <button
                    onClick={() => onRestore(s.showId)}
                    className="text-xs text-[var(--brand-blue)] hover:underline"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function BenchSection({
  shows,
  ringLabelById,
}: {
  shows: TieredShow[];
  ringLabelById: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  if (shows.length === 0) return null;
  const shown = shows.slice(0, PAGE_SIZE * page);
  const remaining = shows.length - shown.length;

  return (
    <section data-testid="tier-bench">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-text-secondary)]"
        aria-expanded={open}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        Other matches ({shows.length})
      </button>
      {open && (
        <>
          <div className="space-y-2 mt-3">
            {shown.map((s) => (
              <BenchShowCard
                key={s.showId}
                entry={s}
                ringLabel={
                  s.ringHypothesisId
                    ? ringLabelById.get(s.ringHypothesisId) ?? null
                    : null
                }
              />
            ))}
          </div>
          {remaining > 0 && (
            <ShowMore
              remaining={remaining}
              onClick={() => setPage((p) => p + 1)}
            />
          )}
        </>
      )}
    </section>
  );
}

// ============================================================
// Cards
// ============================================================

function TestShowCard({
  entry,
  selected,
  onToggle,
  ringLabel,
  onCpmOverride,
  onPlacementOverride,
  recomputing,
}: {
  entry: TieredShow;
  selected: boolean;
  onToggle: () => void;
  ringLabel: string | null;
  onCpmOverride: (showId: string, cpmDollars: number | null) => void;
  onPlacementOverride: (showId: string, placement: Placement) => void;
  recomputing: boolean;
}) {
  const { show } = entry;
  const band = entry.band ?? "low";
  const meta = BAND_META[band];
  const safety = readBrandSafety(show);
  const name = show?.name ?? "Show unavailable";
  const categories = (show?.categories ?? []).slice(0, 3);

  return (
    <label
      data-testid="test-show-card"
      className={`block px-4 py-3.5 rounded-xl border cursor-pointer transition-all ${
        selected
          ? "border-[var(--brand-blue)]/60 bg-[var(--brand-blue)]/[0.04]"
          : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] hover:border-[var(--brand-blue)]/30"
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="mt-1 h-4 w-4 rounded accent-[var(--brand-blue)] cursor-pointer"
          aria-label={`Add ${name} to the test`}
        />
        <ShowAvatar show={show} name={name} />
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
            {ringLabel && <RingTag label={ringLabel} />}
          </div>
          {categories.length > 0 && (
            <div className="text-xs text-[var(--brand-text-muted)] truncate mt-0.5">
              {categories.join(" · ")}
            </div>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <div
            data-testid="composite-score"
            className="text-2xl font-bold text-[var(--brand-text)] leading-none"
          >
            {entry.composite ?? "—"}
          </div>
          <div className="text-[10px] text-[var(--brand-text-muted)] mt-1">
            composite
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-3">
        <SubScore
          label="Audience fit"
          value={AUDIENCE_MEASURED ? entry.audienceFit : null}
          unmeasured={!AUDIENCE_MEASURED}
          accent="bg-[var(--brand-text-muted)]"
        />
        <SubScore
          label="Topical relevance"
          value={entry.topicalRelevance}
          accent="bg-[var(--brand-blue)]"
        />
        <SubScore
          label="Purchase power"
          value={entry.purchasePower}
          accent="bg-[var(--brand-teal)]"
        />
      </div>

      {entry.reasoning && (
        <p className="text-sm text-[var(--brand-text-secondary)] mt-3 leading-snug">
          {entry.reasoning}
        </p>
      )}

      <CostLine entry={entry} />

      <ShowOverrideControls
        entry={entry}
        onCpmOverride={onCpmOverride}
        onPlacementOverride={onPlacementOverride}
        recomputing={recomputing}
      />

      {safety && <BrandSafetyNotice flag={safety} />}

      <ShowAnnotations showId={entry.showId} />
    </label>
  );
}

function ScaleShowCard({
  entry,
  inCart,
  saved,
  onPromote,
  onRemoveFromCart,
  onToggleSave,
  onDismiss,
  ringLabel,
  onCpmOverride,
  onPlacementOverride,
  recomputing,
}: {
  entry: TieredShow;
  inCart: boolean;
  saved: boolean;
  onPromote: () => void;
  onRemoveFromCart: () => void;
  onToggleSave: () => void;
  onDismiss: () => void;
  ringLabel: string | null;
  onCpmOverride: (showId: string, cpmDollars: number | null) => void;
  onPlacementOverride: (showId: string, placement: Placement) => void;
  recomputing: boolean;
}) {
  const { show } = entry;
  const band = entry.band ?? "low";
  const meta = BAND_META[band];
  const name = show?.name ?? "Show unavailable";

  return (
    <div
      data-testid="scale-show-card"
      className="px-4 py-3.5 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface)]"
    >
      <div className="flex items-start gap-3">
        <ShowAvatar show={show} name={name} />
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
            {ringLabel && <RingTag label={ringLabel} />}
          </div>
          {entry.reasoning && (
            <p className="text-sm text-[var(--brand-text-secondary)] mt-1.5 leading-snug">
              {entry.reasoning}
            </p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-sm font-semibold text-[var(--brand-text)]">
            {formatMoneyCents(entry.threeSpotCents)}
          </div>
          <div className="text-[10px] text-[var(--brand-text-muted)]">
            3 spots
          </div>
        </div>
      </div>

      {entry.budgetDeltaCents != null && entry.budgetDeltaCents > 0 && (
        <div
          data-testid="budget-delta"
          className="mt-2 text-xs text-[var(--brand-warning)]"
        >
          ~{formatMoneyCents(entry.budgetDeltaCents)} over the per-show test
          ceiling
        </div>
      )}

      <div className="flex items-center gap-3 mt-3">
        {inCart ? (
          <button
            onClick={onRemoveFromCart}
            className="text-xs font-medium text-[var(--brand-blue)] hover:underline"
          >
            ✓ Added to test — remove
          </button>
        ) : (
          <button
            onClick={onPromote}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-[var(--brand-blue)]/40 text-[var(--brand-blue)] hover:bg-[var(--brand-blue)]/[0.06] transition-all"
          >
            Move to test
          </button>
        )}
        <button
          onClick={onToggleSave}
          className="text-xs text-[var(--brand-text-secondary)] hover:text-[var(--brand-text)]"
        >
          {saved ? "★ Saved" : "☆ Save"}
        </button>
        <button
          onClick={onDismiss}
          className="text-xs text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] ml-auto"
        >
          Dismiss
        </button>
      </div>

      <ShowOverrideControls
        entry={entry}
        onCpmOverride={onCpmOverride}
        onPlacementOverride={onPlacementOverride}
        recomputing={recomputing}
      />

      <ShowAnnotations showId={entry.showId} />
    </div>
  );
}

function BenchShowCard({
  entry,
  ringLabel,
}: {
  entry: TieredShow;
  ringLabel: string | null;
}) {
  const { show } = entry;
  const band = entry.band ?? "speculative";
  const meta = BAND_META[band];
  const name = show?.name ?? "Show unavailable";

  return (
    <div
      data-testid="bench-show-card"
      className="px-4 py-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface)]"
    >
      <div className="flex items-center gap-3">
        <ShowAvatar show={show} name={name} small />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-[var(--brand-text)] truncate">
              {name}
            </span>
            <span
              data-testid="band-badge"
              className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${meta.badge}`}
            >
              {meta.label}
            </span>
            {ringLabel && <RingTag label={ringLabel} />}
          </div>
          {entry.reasoning && (
            <p className="text-xs text-[var(--brand-text-muted)] truncate mt-0.5">
              {entry.reasoning}
            </p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          {entry.needsQuote ? (
            <span
              data-testid="needs-quote"
              className="text-[11px] text-[var(--brand-text-muted)] italic"
            >
              cost unknown — quote at outreach
            </span>
          ) : (
            <span className="text-xs text-[var(--brand-text-muted)]">
              {formatMoneyCents(entry.threeSpotCents)}
            </span>
          )}
        </div>
      </div>

      <ShowAnnotations showId={entry.showId} />
    </div>
  );
}

// ============================================================
// Cost line (per-spot + 3-spot, estimate / flat-fee range)
// ============================================================

function CostLine({ entry }: { entry: TieredShow }) {
  if (entry.needsQuote) {
    return (
      <div
        data-testid="needs-quote"
        className="mt-3 text-xs text-[var(--brand-text-muted)] italic"
      >
        cost unknown — quote at outreach
      </div>
    );
  }

  // flat_fee (non-onboarded YouTube): a guess, never a precise price.
  if (entry.costBasis === "flat_fee") {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="text-[var(--brand-text-secondary)]">
          {flatFeeRange(entry.perSpotCents)} per integration
        </span>
        <span
          data-testid="cost-estimate"
          className="px-1.5 py-0.5 rounded bg-[var(--brand-warning)]/10 text-[var(--brand-warning)] font-medium"
        >
          quote to confirm
        </span>
      </div>
    );
  }

  return (
    <div className="mt-3 flex items-center gap-2 text-xs text-[var(--brand-text-secondary)]">
      <span className="font-medium text-[var(--brand-text)]">
        {formatMoneyCents(entry.perSpotCents)}
      </span>
      <span className="text-[var(--brand-text-muted)]">/ spot ·</span>
      <span className="font-medium text-[var(--brand-text)]">
        {formatMoneyCents(entry.threeSpotCents)}
      </span>
      <span className="text-[var(--brand-text-muted)]">for 3 spots</span>
      {entry.isEstimate && (
        <span
          data-testid="cost-estimate"
          className="px-1.5 py-0.5 rounded bg-[var(--brand-border)]/50 text-[var(--brand-text-muted)] font-medium"
        >
          estimated
        </span>
      )}
    </div>
  );
}

// ============================================================
// Layer 5 override controls
// ============================================================

/** Campaign-level test settings: spot-count + placement segmented controls and
 *  a reset. Each change fires a recompute (the tiers reshuffle). */
function TestSettingsBar({
  spotCount,
  placement,
  onSpotCount,
  onPlacement,
  onReset,
  overridesActive,
  recomputing,
  error,
}: {
  spotCount: number;
  placement: Placement;
  onSpotCount: (n: number) => void;
  onPlacement: (p: Placement) => void;
  onReset: () => void;
  overridesActive: boolean;
  recomputing: boolean;
  error: string | null;
}) {
  return (
    <div className="px-8 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[var(--brand-border)] bg-[var(--brand-surface)]">
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--brand-text-muted)] shrink-0">
          Test cadence
        </span>
        <Segmented
          options={SPOT_COUNT_OPTIONS.map((n) => ({
            value: String(n),
            label: n === 1 ? "1 spot" : `${n} spots`,
          }))}
          value={String(spotCount)}
          onChange={(v) => onSpotCount(Number(v))}
          disabled={recomputing}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--brand-text-muted)] shrink-0">
          Placement
        </span>
        <Segmented
          options={PLACEMENTS.map((p) => ({ value: p.value, label: p.label }))}
          value={placement}
          onChange={(v) => onPlacement(v as Placement)}
          disabled={recomputing}
        />
      </div>
      {overridesActive && (
        <button
          onClick={onReset}
          disabled={recomputing}
          className="text-xs text-[var(--brand-blue)] hover:underline disabled:opacity-50 disabled:no-underline"
        >
          Reset to defaults
        </button>
      )}
      {recomputing && (
        <span
          data-testid="recomputing"
          className="text-xs text-[var(--brand-text-muted)] flex items-center gap-1.5"
        >
          <span className="w-3 h-3 rounded-full border border-[var(--brand-blue)]/30 border-t-[var(--brand-blue)] animate-spin" />
          Recomputing…
        </span>
      )}
      {error && (
        <span className="text-xs text-[var(--brand-error)]">{error}</span>
      )}
    </div>
  );
}

/** Per-show placement + CPM override row on a priced (CPM-based) card. Hidden for
 *  flat-fee / needs-quote shows, which carry no CPM to edit. On a `<label>` card
 *  (test cards) the click is stopped so it doesn't toggle the selection. */
function ShowOverrideControls({
  entry,
  onCpmOverride,
  onPlacementOverride,
  recomputing,
}: {
  entry: TieredShow;
  onCpmOverride: (showId: string, cpmDollars: number | null) => void;
  onPlacementOverride: (showId: string, placement: Placement) => void;
  recomputing: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const currentCpm =
    entry.cpmUsedCents != null ? Math.round(entry.cpmUsedCents / 100) : null;

  // Only CPM-priced shows (podcast derived / onboarded rate_card) can be edited;
  // a flat-fee or needs-quote show has no CPM/placement to override.
  const editable =
    entry.costBasis === "derived" || entry.costBasis === "rate_card";
  if (!editable) return null;

  const commitCpm = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === "") {
      // empty → clear the override (revert to the band-derived CPM)
      onCpmOverride(entry.showId, null);
      return;
    }
    const dollars = Number(trimmed);
    if (Number.isFinite(dollars) && dollars > 0 && dollars !== currentCpm) {
      onCpmOverride(entry.showId, dollars);
    }
  };

  return (
    <div
      data-testid="show-override-controls"
      className="mt-2 flex items-center gap-3 text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      <label className="flex items-center gap-1.5 text-[var(--brand-text-muted)]">
        Placement
        <select
          data-testid="show-placement-select"
          value={entry.placement}
          disabled={recomputing}
          onChange={(e) =>
            onPlacementOverride(entry.showId, e.target.value as Placement)
          }
          className="bg-[var(--brand-surface)] border border-[var(--brand-border)] rounded px-1.5 py-0.5 text-[var(--brand-text)] disabled:opacity-50"
        >
          {PLACEMENTS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <span className="flex items-center gap-1.5 text-[var(--brand-text-muted)]">
        CPM
        {editing ? (
          <input
            data-testid="show-cpm-input"
            type="number"
            min="0"
            step="0.5"
            autoFocus
            defaultValue={currentCpm ?? ""}
            disabled={recomputing}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitCpm}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitCpm();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-16 bg-[var(--brand-surface)] border border-[var(--brand-blue)]/40 rounded px-1.5 py-0.5 text-[var(--brand-text)]"
          />
        ) : (
          <button
            data-testid="show-cpm-edit"
            onClick={() => {
              setDraft(currentCpm != null ? String(currentCpm) : "");
              setEditing(true);
            }}
            disabled={recomputing}
            className="font-medium text-[var(--brand-blue)] hover:underline disabled:opacity-50"
          >
            {currentCpm != null ? `$${currentCpm}` : "set"} ✎
          </button>
        )}
      </span>
    </div>
  );
}

/** Compact segmented control used by the test-settings bar. */
function Segmented({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--brand-border)] overflow-hidden">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          disabled={disabled}
          aria-pressed={value === o.value}
          className={`px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
            value === o.value
              ? "bg-[var(--brand-blue)] text-white"
              : "bg-[var(--brand-surface-elevated)] text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ============================================================
// Budget meter
// ============================================================

function BudgetMeter({
  spentCents,
  budgetCents,
  selectedCount,
  overBudget,
}: {
  spentCents: number;
  budgetCents: number;
  selectedCount: number;
  overBudget: boolean;
}) {
  const pct =
    budgetCents > 0 ? Math.min(100, (spentCents / budgetCents) * 100) : 0;
  return (
    <div data-testid="budget-meter" className="flex-1 max-w-md">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-[var(--brand-text-muted)]">
          {selectedCount} selected ·{" "}
          <span className="font-medium text-[var(--brand-text)]">
            {formatMoneyCents(spentCents)}
          </span>{" "}
          of {formatMoneyCents(budgetCents)}
        </span>
        {overBudget && (
          <span
            data-testid="budget-warning"
            className="font-medium text-[var(--brand-warning)]"
          >
            Over test budget
          </span>
        )}
      </div>
      <div className="h-1.5 rounded-full bg-[var(--brand-border)] overflow-hidden">
        <div
          className={`h-full rounded-full ${
            overBudget ? "bg-[var(--brand-warning)]" : "bg-[var(--brand-blue)]"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ============================================================
// Small section bits
// ============================================================

function SectionHeading({
  title,
  sub,
  count,
  muted,
}: {
  title: string;
  sub: string;
  count: number;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <h2
        className={`text-base font-bold ${
          muted ? "text-[var(--brand-text-secondary)]" : "text-[var(--brand-text)]"
        }`}
      >
        {title}
      </h2>
      <span className="text-xs text-[var(--brand-text-muted)]">
        {count} {count === 1 ? "show" : "shows"}
      </span>
      <span className="text-xs text-[var(--brand-text-muted)] hidden sm:inline">
        {sub}
      </span>
    </div>
  );
}

function EmptySection({ note }: { note: string }) {
  return (
    <div className="mt-3 px-4 py-6 rounded-xl border border-dashed border-[var(--brand-border)] text-center text-sm text-[var(--brand-text-muted)]">
      {note}
    </div>
  );
}

function ShowMore({
  remaining,
  onClick,
}: {
  remaining: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="mt-3 text-xs text-[var(--brand-blue)] hover:underline"
    >
      Show {Math.min(remaining, PAGE_SIZE)} more
    </button>
  );
}

function RingTag({ label }: { label: string }) {
  return (
    <span className="text-[10px] uppercase tracking-wide text-[var(--brand-text-muted)] border border-[var(--brand-border)] rounded px-1.5 py-0.5">
      {label}
    </span>
  );
}

function ShowAvatar({
  show,
  name,
  small,
}: {
  show: Show | null;
  name: string;
  small?: boolean;
}) {
  const size = small ? "w-8 h-8" : "w-10 h-10";
  return (
    <div
      className={`${size} rounded-lg flex-shrink-0 overflow-hidden bg-gradient-to-br from-[var(--brand-blue)]/20 to-[var(--brand-teal)]/20 flex items-center justify-center`}
    >
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

/** Concrete cost figures show full dollars with commas (no K/M abbreviation),
 *  because the brand is comparing exact prices against a budget. Integer cents
 *  in → rounded dollars out. */
function formatMoneyCents(cents: number | null): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

/** Flat-fee (non-onboarded YouTube) is a wild guess — present it as a wide
 *  low-confidence range around the point estimate, never a precise figure. The
 *  ±band width is a presentation choice (calibration), not core cost logic. */
function flatFeeRange(perSpotCents: number | null): string {
  if (perSpotCents == null || !Number.isFinite(perSpotCents))
    return "quote to confirm";
  const lo = Math.round((perSpotCents * 0.5) / 100);
  const hi = Math.round((perSpotCents * 2) / 100);
  return `~$${lo.toLocaleString()}–$${hi.toLocaleString()}`;
}
