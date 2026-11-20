// One local import. Dry run is the default. Commit writes only the
// two internal tables, and only after migration 093 is present.

import { join } from "node:path";
import type { PodscanSearchResponse } from "@/lib/podscan/types";
import { parseArgs, type ImportArgs } from "./args";
import { lookupAppleFeeds } from "./apple";
import {
  activeSince,
  collectCandidates,
  emptySearchState,
  LOWEST_FLOOR,
  readCategories,
  SEARCH_QUERY,
  type CatalogCandidate,
  type SearchState,
} from "./candidates";
import {
  alignCheckpointSample,
  clearImportProgress,
  readCheckpoint,
  writeJsonAtomic,
  writeTextAtomic,
  type Checkpoint,
  type ContactProgress,
  type EnrichProgress,
} from "./checkpoint";
import { formatFailure, inStep, type ImportStep } from "./failure";
import { checkEmails, contactStatus, domainOf, type DnsLike, type MxResult } from "./email";
import { enrichShow, isNotFound } from "./enrich";
import { fetchOwnerEmail, mapPool, FEED_CONCURRENCY, type LookupFn } from "./feed";
import { decideKeep, type KeepReason } from "./keep";
import {
  addCoverage,
  daysAtBudget,
  emptyCoverage,
  printReport,
  proofLine,
  renderReport,
  topDomains,
  type ImportReport,
} from "./report";
import {
  APPLE_CONCURRENCY,
  APPLE_PER_MINUTE,
  HostLimiter,
  PODSCAN_CONCURRENCY,
  PODSCAN_PER_MINUTE,
  PodscanGate,
  PodscanStop,
  sleep,
} from "./rate-limit";
import { catalogRow, contactRows } from "./rows";
import {
  chunkIds,
  PROBE_ACTIVE_DAYS,
  PROBE_CHUNK,
  PROBE_EPISODES,
  probeSponsorRecency,
  scoreProbeChecks,
  type ProbeCheck,
} from "./sponsors";

export { parseArgs };
export type { ImportArgs };

export const SEARCH_SAVE_MS = 60_000;
export const ENRICH_SAVE_MS = 30_000;
export const CONTACT_SAVE_EVERY = 500;

const DAILY_MESSAGE = "Daily Podscan limit reached. Re-run the same command tomorrow to resume.";
const BUDGET_MESSAGE = "Podscan call budget reached. Re-run the same command to resume.";
const SAMPLE_MISMATCH = "Checkpoint sample does not match this run. Starting the search over.";
const PODCAST_ID = /^[A-Za-z0-9_-]+$/;

export interface PodscanCaller {
  get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T>;
  post<T>(path: string, body: Record<string, unknown>): Promise<T>;
  rateLimit(): { limit: number | null; remaining: number | null };
}

export interface DbResult<T> {
  data: T | null;
  error: { code?: string } | null;
}

export interface ShowLink {
  id: string;
  podscan_id: string | null;
}

export interface Db {
  from(table: string): {
    select(columns: string): {
      limit(n: number): Promise<DbResult<unknown>>;
      in(column: string, values: string[]): Promise<DbResult<ShowLink[]>>;
    };
    upsert(rows: Record<string, unknown>[], options: { onConflict: string }): Promise<DbResult<unknown>>;
  };
}

export interface RunDeps {
  caller: PodscanCaller;
  db: Db | null;
  checkpointDir: string;
  now?: () => Date;
  sleepFn?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  lookup?: LookupFn;
  dns?: DnsLike;
  rng?: () => number;
  podscanLimiter?: HostLimiter;
  appleLimiter?: HostLimiter;
  onCheckpoint?: (checkpoint: Checkpoint) => void;
}

interface WorkingShow {
  candidate: CatalogCandidate;
  sponsoredLast12m: boolean;
  latestSponsoredEpisodeId: string | null;
  latestSponsoredAt: string | null;
  contact: ContactProgress;
  reason: KeepReason | null;
}

interface ShowLinks {
  links: Map<string, string | null>;
  present: Set<string>;
}

export async function runImport(args: ImportArgs, deps: RunDeps): Promise<{ exitCode: number }> {
  if (args.commit && args.dryRunExplicit) {
    console.log("Pass either --commit or --dry-run.");
    return { exitCode: 1 };
  }
  if (args.commit && args.sample != null) {
    console.log("Refusing to write a sample. Run --commit without --sample.");
    return { exitCode: 1 };
  }
  if (args.commit && args.floor == null) {
    console.log("Refusing to write without --floor.");
    return { exitCode: 1 };
  }
  if (args.commit && args.confirm == null) {
    console.log("Refusing to write without --confirm.");
    return { exitCode: 1 };
  }
  if (args.partial && !args.commit) {
    console.log("Pass --partial with --commit.");
    return { exitCode: 1 };
  }
  if (args.fresh && args.partial) {
    console.log("Pass either --fresh or --partial.");
    return { exitCode: 1 };
  }
  if (args.commit) {
    if (!deps.db) {
      console.error("Supabase env is not set");
      return { exitCode: 1 };
    }
    if (!(await tablesReady(deps.db))) return { exitCode: 1 };
  }

  const nowFn = deps.now ?? (() => new Date());
  const sleepFn = deps.sleepFn ?? sleep;
  const clock = () => nowFn().getTime();
  const checkpointPath = join(deps.checkpointDir, "checkpoint.json");
  const checkpoint = await readCheckpoint(checkpointPath);
  if (args.partial && checkpoint.sample !== undefined && checkpoint.sample !== args.sample) {
    console.log("Refusing a partial write because the checkpoint sample does not match this run.");
    return { exitCode: 1 };
  }
  const gate = new PodscanGate({
    maxCalls: args.maxPodscanCalls,
    limiter:
      deps.podscanLimiter ??
      new HostLimiter(PODSCAN_PER_MINUTE, PODSCAN_CONCURRENCY, clock, sleepFn),
    sleepFn,
    observe: () => deps.caller.rateLimit(),
  });

  let saveTail: Promise<void> = Promise.resolve();
  const save = () => {
    const run = saveTail.then(async () => {
      try {
        deps.onCheckpoint?.(checkpoint);
        await inStep("checkpoint", () => writeJsonAtomic(checkpointPath, checkpoint));
      } catch (err) {
        console.error(formatFailure("checkpoint", err));
      }
    });
    saveTail = run;
    return run;
  };

  const guarded = <T>(work: () => Promise<T>): Promise<T> => gate.run(work);
  let commitPlan: { floor: number; chosen: WorkingShow[] } | null = null;
  let step: ImportStep = "search";

  try {
    const since = activeSince(nowFn(), args.activeDays);
    step = "search";
    const search = await ensureSearch(args, deps, checkpoint, nowFn, since, guarded, save);
    pruneEnrich(checkpoint, search);
    step = "probe";
    const probe = await ensureProbe(deps, search, checkpoint, nowFn(), guarded, save, args);
    step = "probeCheck";
    await ensureProbeCheck(deps, search, probe, checkpoint, nowFn(), guarded, save, args);
    step = "contacts";
    await inStep("contacts", () => ensureContacts(search, checkpoint, deps, nowFn, save));
    const shows = buildShows(search, probe, checkpoint);
    const kept = {
      1000: shows.filter((show) => keepOf(show, 1000).kept),
      2500: shows.filter((show) => keepOf(show, 2500).kept),
      5000: shows.filter((show) => keepOf(show, 5000).kept),
    };

    if (!args.commit) {
      const proofKept = args.floorSponsored
        ? shows.filter((show) => keepOf(show, LOWEST_FLOOR, true).kept)
        : kept[1000];
      const sample = sortShows(proofKept).slice(0, 5);
      step = "enrich";
      if (!args.noEnrich) await enrichIds(deps, sample, checkpoint, nowFn, guarded, save);
      const links = await countShows(deps.db, shows);
      buildReport(args, search, shows, kept, checkpoint, gate, links, nowFn());
      step = "checkpoint";
      await writeReport(deps.checkpointDir, args, search, shows, kept, checkpoint, gate, links, nowFn());
      return { exitCode: 0 };
    }

    const floor = args.floor ?? 0;
    const chosen = shows.filter((show) => keepOf(show, floor, args.floorSponsored).kept);
    if (args.confirm !== chosen.length) {
      console.log(
        `Refusing to write. --confirm must equal the kept count for this floor (${chosen.length}).`
      );
      return { exitCode: 1 };
    }
    if (!deps.db) {
      console.error("Supabase env is not set");
      return { exitCode: 1 };
    }
    const ordered = sortShows(chosen);
    commitPlan = { floor, chosen: ordered };
    const planCalls = args.noEnrich ? 0 : remainingCalls(ordered, checkpoint.enrich ?? {});
    console.log(
      [
        "Plan",
        `catalog rows: ${ordered.length}`,
        `contact rows: ${ordered.reduce((sum, show) => sum + show.contact.checks.length, 0)}`,
        `podscan calls still needed: ${planCalls}`,
        `days at budget: ${daysAtBudget(planCalls, args.maxPodscanCalls)}`,
      ].join("\n")
    );
    step = "enrich";
    if (!args.noEnrich) await enrichIds(deps, ordered, checkpoint, nowFn, guarded, save);
    const links = await loadShowLinks(
      deps.db,
      ordered.map((show) => show.candidate.podcastId)
    );
    if (links == null) {
      console.log("Refusing to write because the shows lookup failed.");
      return { exitCode: 1 };
    }
    step = "write";
    const wrote = await writeRows(deps.db, ordered, floor, links, checkpoint, nowFn(), args.noEnrich);
    if (!wrote) return { exitCode: 1 };
    console.log(`Upserted catalog rows: ${ordered.length}`);
    return { exitCode: 0 };
  } catch (err) {
    await save();
    if (err instanceof PodscanStop && (err.reason === "daily" || err.reason === "budget")) {
      if (args.commit && commitPlan && deps.db) {
        const ready = commitPlan.chosen.filter((show) => checkpoint.enrich?.[show.candidate.podcastId]);
        const links = await loadShowLinks(
          deps.db,
          ready.map((show) => show.candidate.podcastId)
        );
        if (links == null) {
          console.log("Refusing to write because the shows lookup failed.");
        } else {
          step = "write";
          const wrote = await writeRows(deps.db, ready, commitPlan.floor, links, checkpoint, nowFn(), args.noEnrich);
          if (!wrote) return { exitCode: 1 };
          console.log(
            `Upserted ${ready.length} of ${commitPlan.chosen.length}. Re-run the same command to continue.`
          );
        }
        return { exitCode: 0 };
      }
      console.log(err.reason === "daily" ? DAILY_MESSAGE : BUDGET_MESSAGE);
      return { exitCode: 0 };
    }
    console.error(formatFailure(step, err));
    return { exitCode: 1 };
  }
}

function withoutAudience(shows: WorkingShow[]): number {
  return shows.filter((show) => show.candidate.audienceSize == null).length;
}

function keepOf(
  show: WorkingShow,
  floor: number,
  floorSponsored = false
): { kept: boolean; reason: KeepReason | null } {
  return decideKeep(
    { sponsoredLast12m: show.sponsoredLast12m, audienceSize: show.candidate.audienceSize },
    floor,
    { floorSponsored }
  );
}

function includeInProbe(audienceSize: number | null, args: ImportArgs): boolean {
  if (!args.floorSponsored) return true;
  const floor = args.floor ?? LOWEST_FLOOR;
  return audienceSize != null && audienceSize >= floor;
}

function callsForFlags(args: ImportArgs, shows: WorkingShow[], checkpoint: Checkpoint): number {
  const floor = args.floor ?? LOWEST_FLOOR;
  const chosen = shows.filter((show) => keepOf(show, floor, args.floorSponsored).kept);
  let calls = args.noEnrich ? 0 : remainingCalls(chosen, checkpoint.enrich ?? {});
  const probe = checkpoint.probe ?? {};
  let unprobed = 0;
  for (const show of shows) {
    if (show.candidate.podcastId in probe) continue;
    if (!includeInProbe(show.candidate.audienceSize, args)) continue;
    unprobed += 1;
  }
  if (unprobed > 0) calls += Math.ceil(unprobed / PROBE_CHUNK);
  if (!checkpoint.probeCheck || !checkpoint.probeCheckSavedAt) {
    let picks = 0;
    for (const show of shows) {
      if (show.candidate.pass !== "sponsored") continue;
      if (!includeInProbe(show.candidate.audienceSize, args)) continue;
      picks += 1;
      if (picks >= 20) break;
    }
    calls += picks;
  }
  return calls;
}

function sortShows(shows: WorkingShow[]): WorkingShow[] {
  return [...shows].sort((a, b) => {
    if (a.sponsoredLast12m !== b.sponsoredLast12m) return a.sponsoredLast12m ? -1 : 1;
    return (b.candidate.audienceSize ?? -1) - (a.candidate.audienceSize ?? -1);
  });
}

function pruneEnrich(checkpoint: Checkpoint, search: SearchState): void {
  if (!checkpoint.enrich) return;
  const ids = new Set(search.rows.map((row) => row.podcastId));
  for (const id of Object.keys(checkpoint.enrich)) {
    if (!ids.has(id)) delete checkpoint.enrich[id];
  }
}

async function ensureSearch(
  args: ImportArgs,
  deps: RunDeps,
  checkpoint: Checkpoint,
  nowFn: () => Date,
  since: string,
  guarded: <T>(work: () => Promise<T>) => Promise<T>,
  save: () => Promise<void>
): Promise<SearchState> {
  if (args.fresh) clearImportProgress(checkpoint);
  if (!args.partial && alignCheckpointSample(checkpoint, args.sample)) {
    console.log(SAMPLE_MISMATCH);
  }
  if (args.partial) {
    const state = checkpoint.search ?? emptySearchState();
    checkpoint.search = state;
    if (!checkpoint.searchSavedAt) checkpoint.searchSavedAt = nowFn().toISOString();
    await save();
    return state;
  }
  if (checkpoint.search?.complete) return checkpoint.search;
  const resume = checkpoint.search ?? emptySearchState();
  checkpoint.search = resume;
  let categoriesNoted = false;
  let lastSearchSave = Number.NEGATIVE_INFINITY;
  const state = await collectCandidates({
    language: args.language,
    region: args.region,
    since,
    sample: args.sample,
    resume,
    search: (params) =>
      inStep("search", () => guarded(() => deps.caller.get<PodscanSearchResponse>("/podcasts/search", params))),
    categories: async () => {
      const note = (err: unknown) => {
        if (categoriesNoted) return;
        categoriesNoted = true;
        console.error(formatFailure("categories", err));
      };
      try {
        const body = await inStep("categories", () => guarded(() => deps.caller.get<unknown>("/categories")));
        const read = readCategories(body);
        if (!read.recognized) {
          const err = new Error("unexpected categories shape");
          err.name = "TypeError";
          note(err);
          return [];
        }
        return read.ids;
      } catch (err) {
        if (err instanceof PodscanStop) throw err;
        note(err);
        return [];
      }
    },
    onProgress: async (next, update) => {
      checkpoint.search = next;
      checkpoint.searchSavedAt = nowFn().toISOString();
      const t = nowFn().getTime();
      if (update.finishedSlice || t - lastSearchSave >= SEARCH_SAVE_MS) {
        lastSearchSave = t;
        await save();
      }
    },
  });
  checkpoint.search = state;
  checkpoint.searchSavedAt = nowFn().toISOString();
  await save();
  return state;
}

async function ensureProbe(
  deps: RunDeps,
  search: SearchState,
  checkpoint: Checkpoint,
  now: Date,
  guarded: <T>(work: () => Promise<T>) => Promise<T>,
  save: () => Promise<void>,
  args: ImportArgs
): Promise<Record<string, string | null>> {
  const probe = checkpoint.probe ?? {};
  const missing = search.rows
    .filter((row) => includeInProbe(row.audienceSize, args) && !(row.podcastId in probe))
    .map((row) => row.podcastId);
  for (const chunk of chunkIds(missing, PROBE_CHUNK)) {
    const found = await probeSponsorRecency(chunk, (ids) =>
      inStep("probe", () =>
        guarded(() =>
          deps.caller.post<{ results?: Record<string, string | null> }>("/podcasts/batch-probe", {
            podcast_ids: ids,
            has_sponsors: true,
            active_within_days: PROBE_ACTIVE_DAYS,
            episodes_to_check: PROBE_EPISODES,
          })
        )
      )
    );
    Object.assign(probe, found);
    checkpoint.probe = probe;
    checkpoint.probeSavedAt = now.toISOString();
    await save();
  }
  checkpoint.probe = probe;
  checkpoint.probeSavedAt = now.toISOString();
  await save();
  return probe;
}

async function ensureProbeCheck(
  deps: RunDeps,
  search: SearchState,
  probe: Record<string, string | null>,
  checkpoint: Checkpoint,
  now: Date,
  guarded: <T>(work: () => Promise<T>) => Promise<T>,
  save: () => Promise<void>,
  args: ImportArgs
): Promise<void> {
  if (checkpoint.probeCheck && checkpoint.probeCheckSavedAt) return;
  const picks = search.rows
    .filter((row) => row.pass === "sponsored" && includeInProbe(row.audienceSize, args))
    .slice(0, 20);
  const checks: ProbeCheck[] = [];
  for (const row of picks) {
    const latest = await fetchLatestSponsor(deps, row.podcastId, guarded);
    checks.push({
      podcastId: row.podcastId,
      probeEpisodeId: probe[row.podcastId] ?? null,
      postedAt: latest.postedAt,
      missing: latest.missing,
    });
  }
  const scored = scoreProbeChecks(checks, now);
  checkpoint.probeCheck = {
    pass: scored.pass,
    mismatches: scored.mismatches,
    checked: checks.length,
    checks,
  };
  checkpoint.probeCheckSavedAt = now.toISOString();
  await save();
}

async function fetchLatestSponsor(
  deps: RunDeps,
  podcastId: string,
  guarded: <T>(work: () => Promise<T>) => Promise<T>
): Promise<{ postedAt: string | null; missing: boolean }> {
  if (!PODCAST_ID.test(podcastId)) return { postedAt: null, missing: true };
  try {
    const body = await inStep("probeCheck", () =>
      guarded(() => deps.caller.get<unknown>(`/podcasts/${podcastId}/latest/sponsor`))
    );
    return { postedAt: postedAtFrom(body), missing: false };
  } catch (err) {
    if (isNotFound(err)) return { postedAt: null, missing: true };
    throw err;
  }
}

function postedAtFrom(body: unknown): string | null {
  if (!isRecord(body)) return null;
  if (typeof body.posted_at === "string" && body.posted_at) return body.posted_at;
  if (isRecord(body.episode) && typeof body.episode.posted_at === "string" && body.episode.posted_at) {
    return body.episode.posted_at;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function ensureContacts(
  search: SearchState,
  checkpoint: Checkpoint,
  deps: RunDeps,
  nowFn: () => Date,
  save: () => Promise<void>
): Promise<void> {
  const contacts = checkpoint.contacts ?? {};
  const mxCache = new Map<string, MxResult>(Object.entries(checkpoint.mx ?? {}));
  const pending = search.rows.filter((row) => !contacts[row.podcastId]);
  const appleIds = pending.map((row) => row.itunesId).filter((id): id is string => !!id);
  const limiter =
    deps.appleLimiter ??
    new HostLimiter(
      APPLE_PER_MINUTE,
      APPLE_CONCURRENCY,
      () => nowFn().getTime(),
      deps.sleepFn ?? sleep
    );
  const apple = await lookupAppleFeeds(appleIds, {
    fetchImpl: deps.fetchImpl,
    limiter,
    sleepFn: deps.sleepFn,
    rng: deps.rng,
  });
  const dns = deps.dns ?? (await realDns());
  let done = 0;
  await mapPool(pending, FEED_CONCURRENCY, async (row) => {
    const appleFeed = row.itunesId ? (apple.feeds.get(row.itunesId) ?? null) : null;
    let feedSource: ContactProgress["feedSource"] = "none";
    let feedUrl: string | null = null;
    if (appleFeed) {
      feedSource = "apple";
      feedUrl = appleFeed;
    } else if (row.rssUrl) {
      feedSource = "podscan";
      feedUrl = row.rssUrl;
    }
    let rssEmail: string | null = null;
    let feedSkip: string | null = null;
    if (feedUrl) {
      const fetched = await fetchOwnerEmail(feedUrl, { fetchImpl: deps.fetchImpl, lookup: deps.lookup });
      rssEmail = fetched.email;
      feedSkip = fetched.skip;
    }
    const scanned = await checkEmails(
      [
        ...(row.podscanEmail ? [{ source: "podscan" as const, raw: row.podscanEmail }] : []),
        ...(rssEmail ? [{ source: "apple_rss" as const, raw: rssEmail }] : []),
      ],
      dns,
      mxCache
    );
    contacts[row.podcastId] = {
      appleFeedUrl: appleFeed,
      feedSource,
      feedUrl,
      feedSkip,
      rssEmail,
      checks: scanned.checks,
      syntaxFailureReasons: scanned.syntaxFailureReasons,
    };
    done += 1;
    if (done > 0 && done % CONTACT_SAVE_EVERY === 0) {
      checkpoint.contacts = contacts;
      checkpoint.mx = Object.fromEntries(mxCache);
      checkpoint.contactsSavedAt = nowFn().toISOString();
      await save();
    }
  });
  checkpoint.contacts = contacts;
  checkpoint.mx = Object.fromEntries(mxCache);
  checkpoint.contactsSavedAt = nowFn().toISOString();
  await save();
}

function buildShows(
  search: SearchState,
  probe: Record<string, string | null>,
  checkpoint: Checkpoint
): WorkingShow[] {
  const postedAt = new Map<string, string>();
  for (const check of checkpoint.probeCheck?.checks ?? []) {
    if (check.postedAt) postedAt.set(check.podcastId, check.postedAt);
  }
  return search.rows.map((candidate) => {
    const episodeId = probe[candidate.podcastId] ?? null;
    const contact = checkpoint.contacts?.[candidate.podcastId] ?? {
      appleFeedUrl: null,
      feedSource: "none" as const,
      feedUrl: null,
      feedSkip: null,
      rssEmail: null,
      checks: [],
      syntaxFailureReasons: {},
    };
    return {
      candidate,
      sponsoredLast12m: episodeId != null,
      latestSponsoredEpisodeId: episodeId,
      latestSponsoredAt: postedAt.get(candidate.podcastId) ?? null,
      contact,
      reason: null,
    };
  });
}

async function enrichIds(
  deps: RunDeps,
  shows: WorkingShow[],
  checkpoint: Checkpoint,
  nowFn: () => Date,
  guarded: <T>(work: () => Promise<T>) => Promise<T>,
  save: () => Promise<void>
): Promise<void> {
  const enrich = checkpoint.enrich ?? {};
  const get = (path: string): Promise<unknown> => {
    const id = path.split("/")[2] ?? "";
    if (!PODCAST_ID.test(id)) return Promise.resolve(null);
    return inStep("enrich", () => guarded(() => deps.caller.get(path)));
  };
  let lastSave = Number.NEGATIVE_INFINITY;
  let dirty = false;
  for (const show of shows) {
    const id = show.candidate.podcastId;
    if (enrich[id]) continue;
    const result = await enrichShow(id, show.candidate.listenerEngagement, get);
    enrich[id] = result;
    checkpoint.enrich = enrich;
    checkpoint.enrichSavedAt = nowFn().toISOString();
    dirty = true;
    const t = nowFn().getTime();
    if (t - lastSave >= ENRICH_SAVE_MS) {
      lastSave = t;
      dirty = false;
      await save();
    }
  }
  checkpoint.enrich = enrich;
  if (dirty) await save();
}

async function countShows(
  db: Db | null,
  shows: WorkingShow[]
): Promise<{ 1000: number | null; 2500: number | null; 5000: number | null }> {
  if (!db) return { 1000: null, 2500: null, 5000: null };
  const loaded = await loadShowLinks(
    db,
    shows.map((show) => show.candidate.podcastId)
  );
  if (loaded == null) return { 1000: null, 2500: null, 5000: null };
  return {
    1000: countPresent(shows, loaded.present, 1000),
    2500: countPresent(shows, loaded.present, 2500),
    5000: countPresent(shows, loaded.present, 5000),
  };
}

function countPresent(shows: WorkingShow[], present: Set<string>, floor: number): number {
  let count = 0;
  for (const show of shows) {
    if (!keepOf(show, floor).kept) continue;
    if (present.has(show.candidate.podcastId)) count += 1;
  }
  return count;
}

async function loadShowLinks(db: Db, ids: string[]): Promise<ShowLinks | null> {
  const groups = new Map<string, string[]>();
  for (const batch of chunkIds(ids, 200)) {
    if (batch.length === 0) continue;
    const { data, error } = await db.from("shows").select("id, podscan_id").in("podscan_id", batch);
    if (error) {
      console.error(error.code ?? "db_error");
      return null;
    }
    for (const row of data ?? []) {
      if (!row.podscan_id || !row.id) continue;
      const list = groups.get(row.podscan_id) ?? [];
      list.push(row.id);
      groups.set(row.podscan_id, list);
    }
  }
  const links = new Map<string, string | null>();
  const present = new Set<string>();
  for (const id of ids) {
    const list = groups.get(id) ?? [];
    links.set(id, list.length === 1 ? list[0] : null);
    if (list.length > 0) present.add(id);
  }
  return { links, present };
}

async function tablesReady(db: Db): Promise<boolean> {
  for (const table of ["podscan_catalog", "show_contacts"]) {
    const { error } = await db.from(table).select("podscan_id").limit(0);
    if (error?.code === "42P01") {
      console.log("Migration 093 is not applied.");
      return false;
    }
    if (error) {
      console.error(error.code ?? "db_error");
      return false;
    }
  }
  return true;
}

function remainingCalls(shows: WorkingShow[], enrich: Record<string, EnrichProgress>): number {
  let calls = 0;
  for (const show of shows) {
    if (enrich[show.candidate.podcastId]) continue;
    calls += 1;
    if (show.candidate.listenerEngagement == null) calls += 1;
  }
  return calls;
}

async function writeRows(
  db: Db,
  shows: WorkingShow[],
  floor: number,
  links: ShowLinks,
  checkpoint: Checkpoint,
  now: Date,
  noEnrich: boolean
): Promise<boolean> {
  const updatedAt = now.toISOString();
  const catalog: Record<string, unknown>[] = [];
  const contacts: Record<string, unknown>[] = [];
  for (const show of shows) {
    const decision = keepOf(show, floor);
    if (!decision.kept || !decision.reason) continue;
    const enrich = checkpoint.enrich?.[show.candidate.podcastId];
    const showId = links.links.get(show.candidate.podcastId) ?? null;
    const listener = enrich ? enrich.listener : noEnrich ? null : show.candidate.listenerEngagement;
    catalog.push(
      catalogRow({
        candidate: show.candidate,
        sponsoredLast12m: show.sponsoredLast12m,
        latestSponsoredEpisodeId: show.latestSponsoredEpisodeId,
        latestSponsoredAt: show.latestSponsoredAt,
        appleFeedUrl: show.contact.appleFeedUrl,
        feedUrl: show.contact.feedUrl,
        reason: decision.reason,
        floor,
        demographics: enrich ? enrich.demographics : null,
        listener,
        contactStatus: contactStatus(show.contact.checks.map((check) => check.status)),
        showId,
        updatedAt,
      })
    );
    contacts.push(
      ...contactRows({
        podscanId: show.candidate.podcastId,
        showId,
        checks: show.contact.checks,
        updatedAt,
      })
    );
  }
  if (!(await upsert(db, "podscan_catalog", catalog, "podscan_id"))) return false;
  if (!(await upsert(db, "show_contacts", contacts, "podscan_id,source,email"))) return false;
  return true;
}

async function upsert(
  db: Db,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string
): Promise<boolean> {
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    if (batch.length === 0) continue;
    const { error } = await db.from(table).upsert(batch, { onConflict });
    if (error) {
      console.error(error.code ?? "db_error");
      return false;
    }
  }
  return true;
}

function assembleReport(
  args: ImportArgs,
  search: SearchState,
  shows: WorkingShow[],
  kept: Record<1000 | 2500 | 5000, WorkingShow[]>,
  checkpoint: Checkpoint,
  gate: PodscanGate,
  already: { 1000: number | null; 2500: number | null; 5000: number | null },
  now: Date
): ImportReport {
  const coverage = { 1000: emptyCoverage(), 2500: emptyCoverage(), 5000: emptyCoverage() };
  for (const floor of [1000, 2500, 5000] as const) {
    for (const show of kept[floor]) {
      const sources = new Set(show.contact.checks.map((check) => check.source));
      addCoverage(coverage[floor], sources.has("podscan"), sources.has("apple_rss"));
    }
  }
  let syntaxPass = 0;
  let syntaxFail = 0;
  let mxPass = 0;
  let mxFail = 0;
  let mxUnknown = 0;
  const domains: string[] = [];
  const skipped: Record<string, number> = {};
  const syntaxFailureReasons: Record<string, number> = {};
  let hasSponsorsProbeNull = 0;
  for (const show of shows) {
    if (show.candidate.hasSponsors && !show.sponsoredLast12m) hasSponsorsProbeNull += 1;
    if (show.contact.feedSkip) skipped[show.contact.feedSkip] = (skipped[show.contact.feedSkip] ?? 0) + 1;
    for (const [reason, count] of Object.entries(show.contact.syntaxFailureReasons ?? {})) {
      if (!count || reason.includes("@") || /\s/.test(reason)) continue;
      syntaxFailureReasons[reason] = (syntaxFailureReasons[reason] ?? 0) + count;
    }
    for (const check of show.contact.checks) {
      if (check.syntaxOk) syntaxPass += 1;
      else syntaxFail += 1;
      if (check.mxOk === true) mxPass += 1;
      else if (check.mxOk === false) mxFail += 1;
      else mxUnknown += 1;
      const domain = domainOf(check.email);
      if (domain) domains.push(domain);
    }
  }
  const proofIds = sortShows(kept[1000]).slice(0, 5).map((show) => show.candidate.podcastId);
  let demoHits = 0;
  let listenerHits = 0;
  for (const id of proofIds) {
    const row = checkpoint.enrich?.[id];
    if (row && row.demographics != null) demoHits += 1;
    if (row && row.listener != null) listenerHits += 1;
  }
  const enrich = checkpoint.enrich ?? {};
  return {
    generatedAt: now.toISOString(),
    sample: args.sample,
    language: args.language,
    region: args.region,
    activeDays: args.activeDays,
    candidates: { sponsored: search.passCounts.sponsored, unsponsored: search.passCounts.unsponsored },
    sponsoredLast12m: shows.filter((show) => show.sponsoredLast12m).length,
    hasSponsorsProbeNull,
    kept: { 1000: kept[1000].length, 2500: kept[2500].length, 5000: kept[5000].length },
    keptFloorSponsored: {
      1000: shows.filter((show) => keepOf(show, 1000, true).kept).length,
      2500: shows.filter((show) => keepOf(show, 2500, true).kept).length,
      5000: shows.filter((show) => keepOf(show, 5000, true).kept).length,
    },
    floorConfirm:
      args.floor == null
        ? null
        : {
            floor: args.floor,
            kept: shows.filter((show) => keepOf(show, args.floor ?? 0, false).kept).length,
            keptFloorSponsored: shows.filter((show) => keepOf(show, args.floor ?? 0, true).kept).length,
          },
    podscanCallsForFlags: callsForFlags(args, shows, checkpoint),
    probeFloor: args.floorSponsored ? (args.floor ?? LOWEST_FLOOR) : null,
    keptNoAudience: {
      1000: withoutAudience(kept[1000]),
      2500: withoutAudience(kept[2500]),
      5000: withoutAudience(kept[5000]),
    },
    emailCoverage: coverage,
    syntax: { pass: syntaxPass, fail: syntaxFail },
    syntaxFailureReasons,
    mx: { pass: mxPass, fail: mxFail, unknown: mxUnknown },
    topDomains: topDomains(domains),
    feedsSkipped: skipped,
    demographics: proofLine(demoHits),
    listenerData: proofLine(listenerHits),
    sponsorProbe: checkpoint.probeCheck?.pass ? "PASS" : "FAIL",
    sponsorProbeChecked: checkpoint.probeCheck?.checked ?? 0,
    sponsorProbeMismatches: checkpoint.probeCheck?.mismatches ?? [],
    rateLimit: {
      limit: gate.firstLimit,
      remaining: gate.firstRemaining,
      lastLimit: gate.lastLimit,
      lastRemaining: gate.lastRemaining,
    },
    podscanCalls: gate.callsUsed,
    maxPodscanCalls: args.maxPodscanCalls,
    writeRun: {
      1000: planFloor(activeKept(shows, 1000, args), enrich, args.maxPodscanCalls, args.noEnrich),
      2500: planFloor(activeKept(shows, 2500, args), enrich, args.maxPodscanCalls, args.noEnrich),
      5000: planFloor(activeKept(shows, 5000, args), enrich, args.maxPodscanCalls, args.noEnrich),
    },
    cappedSlices: search.cappedSlices,
    alreadyInShows: already,
    query: SEARCH_QUERY,
  };
}

function buildReport(
  args: ImportArgs,
  search: SearchState,
  shows: WorkingShow[],
  kept: Record<1000 | 2500 | 5000, WorkingShow[]>,
  checkpoint: Checkpoint,
  gate: PodscanGate,
  already: { 1000: number | null; 2500: number | null; 5000: number | null },
  now: Date
): ImportReport {
  const report = assembleReport(args, search, shows, kept, checkpoint, gate, already, now);
  const rendered = renderReport(report);
  printReport(report, rendered.markdown);
  return report;
}

function activeKept(shows: WorkingShow[], floor: number, args: ImportArgs): WorkingShow[] {
  return shows.filter((show) => keepOf(show, floor, args.floorSponsored).kept);
}

function planFloor(
  shows: WorkingShow[],
  enrich: Record<string, EnrichProgress>,
  budget: number,
  noEnrich = false
): { calls: number; days: number } {
  if (noEnrich) return { calls: 0, days: 0 };
  const calls = remainingCalls(shows, enrich);
  return { calls, days: daysAtBudget(calls, budget) };
}

async function writeReport(
  dir: string,
  args: ImportArgs,
  search: SearchState,
  shows: WorkingShow[],
  kept: Record<1000 | 2500 | 5000, WorkingShow[]>,
  checkpoint: Checkpoint,
  gate: PodscanGate,
  already: { 1000: number | null; 2500: number | null; 5000: number | null },
  now: Date
): Promise<void> {
  const report = assembleReport(args, search, shows, kept, checkpoint, gate, already, now);
  const day = now.toISOString().slice(0, 10);
  const rendered = renderReport(report);
  await writeTextAtomic(join(dir, `report-${day}.json`), rendered.json);
  await writeTextAtomic(join(dir, `report-${day}.md`), rendered.markdown);
}

async function realDns(): Promise<DnsLike> {
  const dns = await import("node:dns/promises");
  return {
    resolveMx: (domain) => dns.resolveMx(domain),
    resolve4: (domain) => dns.resolve4(domain),
    resolve6: (domain) => dns.resolve6(domain),
  };
}
