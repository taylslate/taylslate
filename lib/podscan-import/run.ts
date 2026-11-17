// One local import. Dry run is the default. Commit writes only the
// two internal tables, and only after migration 093 is present.

import { join } from "node:path";
import type { PodscanSearchResponse } from "@/lib/podscan/types";
import { parseArgs, type ImportArgs } from "./args";
import { lookupAppleFeeds } from "./apple";
import {
  activeSince,
  categoryIdsFrom,
  collectCandidates,
  emptySearchState,
  SEARCH_QUERY,
  type CatalogCandidate,
  type SearchState,
} from "./candidates";
import {
  isStale,
  readCheckpoint,
  writeJsonAtomic,
  writeTextAtomic,
  type Checkpoint,
  type ContactProgress,
  type EnrichProgress,
} from "./checkpoint";
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

const DAILY_MESSAGE = "Daily Podscan limit reached. Re-run the same command tomorrow to resume.";
const BUDGET_MESSAGE = "Podscan call budget reached. Re-run the same command to resume.";
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
  const gate = new PodscanGate({
    maxCalls: args.maxPodscanCalls,
    limiter:
      deps.podscanLimiter ??
      new HostLimiter(PODSCAN_PER_MINUTE, PODSCAN_CONCURRENCY, clock, sleepFn),
    sleepFn,
    observe: () => deps.caller.rateLimit(),
  });

  const save = async () => {
    try {
      await writeJsonAtomic(checkpointPath, checkpoint);
    } catch {
      console.error("checkpoint save failed");
    }
  };

  const guarded = <T>(work: () => Promise<T>): Promise<T> => gate.run(work);
  let commitPlan: { floor: number; chosen: WorkingShow[] } | null = null;

  try {
    const since = activeSince(nowFn(), args.activeDays);
    const search = await ensureSearch(args, deps, checkpoint, nowFn(), since, guarded, save, args.commit);
    pruneEnrich(checkpoint, search);
    const probe = await ensureProbe(deps, search, checkpoint, nowFn(), guarded, save, args.commit);
    await ensureProbeCheck(deps, search, probe, checkpoint, nowFn(), guarded, save);
    await ensureContacts(search, checkpoint, deps, nowFn(), save, args.commit);
    const shows = buildShows(search, probe, checkpoint);
    const kept = {
      1000: shows.filter((show) => keepOf(show, 1000).kept),
      2500: shows.filter((show) => keepOf(show, 2500).kept),
      5000: shows.filter((show) => keepOf(show, 5000).kept),
    };

    if (!args.commit) {
      const sample = sortShows(kept[1000]).slice(0, 5);
      await enrichIds(deps, sample, checkpoint, nowFn(), guarded, save);
      const links = await countShows(deps.db, shows);
      buildReport(args, search, shows, kept, checkpoint, gate, links, nowFn());
      await writeReport(deps.checkpointDir, args, search, shows, kept, checkpoint, gate, links, nowFn());
      return { exitCode: 0 };
    }

    const floor = args.floor ?? 0;
    const chosen = shows.filter((show) => keepOf(show, floor).kept);
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
    const planCalls = remainingCalls(ordered, checkpoint.enrich ?? {});
    console.log(
      [
        "Plan",
        `catalog rows: ${ordered.length}`,
        `contact rows: ${ordered.reduce((sum, show) => sum + show.contact.checks.length, 0)}`,
        `podscan calls still needed: ${planCalls}`,
        `days at budget: ${daysAtBudget(planCalls, args.maxPodscanCalls)}`,
      ].join("\n")
    );
    await enrichIds(deps, ordered, checkpoint, nowFn(), guarded, save);
    const links = await loadShowLinks(
      deps.db,
      ordered.map((show) => show.candidate.podcastId)
    );
    if (links == null) {
      console.log("Refusing to write because the shows lookup failed.");
      return { exitCode: 1 };
    }
    const wrote = await writeRows(deps.db, ordered, floor, links, checkpoint, nowFn());
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
          const wrote = await writeRows(deps.db, ready, commitPlan.floor, links, checkpoint, nowFn());
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
    const status =
      err && typeof err === "object" && typeof (err as { status?: unknown }).status === "number"
        ? (err as { status: number }).status
        : null;
    console.error(status == null ? "podscan-import failed" : `podscan-import failed status=${status}`);
    return { exitCode: 1 };
  }
}

function withoutAudience(shows: WorkingShow[]): number {
  return shows.filter((show) => show.candidate.audienceSize == null).length;
}

function keepOf(show: WorkingShow, floor: number): { kept: boolean; reason: KeepReason | null } {
  return decideKeep(
    { sponsoredLast12m: show.sponsoredLast12m, audienceSize: show.candidate.audienceSize },
    floor
  );
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
  now: Date,
  since: string,
  guarded: <T>(work: () => Promise<T>) => Promise<T>,
  save: () => Promise<void>,
  commit: boolean
): Promise<SearchState> {
  const nowMs = now.getTime();
  const searchFresh = commit || !isStale(checkpoint.searchSavedAt, nowMs);
  if (checkpoint.search && checkpoint.searchSavedAt && searchFresh && checkpoint.search.complete) {
    return checkpoint.search;
  }
  if (!commit && checkpoint.searchSavedAt && isStale(checkpoint.searchSavedAt, nowMs)) {
    checkpoint.search = undefined;
    checkpoint.searchSavedAt = undefined;
    checkpoint.probe = undefined;
    checkpoint.probeSavedAt = undefined;
    checkpoint.probeCheck = undefined;
    checkpoint.probeCheckSavedAt = undefined;
    checkpoint.contacts = undefined;
    checkpoint.contactsSavedAt = undefined;
    checkpoint.mx = undefined;
  }
  const resume =
    checkpoint.search && checkpoint.searchSavedAt && (commit || !isStale(checkpoint.searchSavedAt, nowMs))
      ? checkpoint.search
      : emptySearchState();
  checkpoint.search = resume;
  const state = await collectCandidates({
    language: args.language,
    region: args.region,
    since,
    sample: args.sample,
    resume,
    search: (params) => guarded(() => deps.caller.get<PodscanSearchResponse>("/podcasts/search", params)),
    categories: async () => {
      const body = await guarded(() => deps.caller.get<unknown>("/categories"));
      return categoryIdsFrom(body);
    },
    onProgress: (next) => {
      checkpoint.search = next;
      checkpoint.searchSavedAt = now.toISOString();
    },
  });
  checkpoint.search = state;
  checkpoint.searchSavedAt = now.toISOString();
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
  commit: boolean
): Promise<Record<string, string | null>> {
  const nowMs = now.getTime();
  if (!commit && checkpoint.probeSavedAt && isStale(checkpoint.probeSavedAt, nowMs)) {
    checkpoint.probe = undefined;
    checkpoint.probeSavedAt = undefined;
    checkpoint.probeCheck = undefined;
    checkpoint.probeCheckSavedAt = undefined;
  }
  const probe = checkpoint.probe ?? {};
  const missing = search.rows.map((row) => row.podcastId).filter((id) => !(id in probe));
  for (const chunk of chunkIds(missing, PROBE_CHUNK)) {
    const found = await probeSponsorRecency(chunk, (ids) =>
      guarded(() =>
        deps.caller.post<{ results?: Record<string, string | null> }>("/podcasts/batch-probe", {
          podcast_ids: ids,
          has_sponsors: true,
          active_within_days: PROBE_ACTIVE_DAYS,
          episodes_to_check: PROBE_EPISODES,
        })
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
  save: () => Promise<void>
): Promise<void> {
  const nowMs = now.getTime();
  if (
    checkpoint.probeCheck &&
    checkpoint.probeCheckSavedAt &&
    !isStale(checkpoint.probeCheckSavedAt, nowMs)
  ) {
    return;
  }
  const picks = search.rows.filter((row) => row.pass === "sponsored").slice(0, 20);
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
    const body = await guarded(() => deps.caller.get<unknown>(`/podcasts/${podcastId}/latest/sponsor`));
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
  now: Date,
  save: () => Promise<void>,
  commit: boolean
): Promise<void> {
  const nowMs = now.getTime();
  if (!commit && checkpoint.contactsSavedAt && isStale(checkpoint.contactsSavedAt, nowMs)) {
    checkpoint.contacts = undefined;
    checkpoint.contactsSavedAt = undefined;
    checkpoint.mx = undefined;
  }
  const contacts = checkpoint.contacts ?? {};
  const mxCache = new Map<string, MxResult>(Object.entries(checkpoint.mx ?? {}));
  const pending = search.rows.filter((row) => !contacts[row.podcastId]);
  const appleIds = pending.map((row) => row.itunesId).filter((id): id is string => !!id);
  const limiter =
    deps.appleLimiter ??
    new HostLimiter(
      APPLE_PER_MINUTE,
      APPLE_CONCURRENCY,
      () => (deps.now ?? (() => new Date()))().getTime(),
      deps.sleepFn ?? sleep
    );
  const apple = await lookupAppleFeeds(appleIds, {
    fetchImpl: deps.fetchImpl,
    limiter,
    sleepFn: deps.sleepFn,
    rng: deps.rng,
  });
  const dns = deps.dns ?? (await realDns());
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
  });
  checkpoint.contacts = contacts;
  checkpoint.mx = Object.fromEntries(mxCache);
  checkpoint.contactsSavedAt = now.toISOString();
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
  now: Date,
  guarded: <T>(work: () => Promise<T>) => Promise<T>,
  save: () => Promise<void>
): Promise<void> {
  const enrich = checkpoint.enrich ?? {};
  const get = (path: string): Promise<unknown> => {
    const id = path.split("/")[2] ?? "";
    if (!PODCAST_ID.test(id)) return Promise.resolve(null);
    return guarded(() => deps.caller.get(path));
  };
  for (const show of shows) {
    const id = show.candidate.podcastId;
    if (enrich[id]) continue;
    const result = await enrichShow(id, show.candidate.listenerEngagement, get);
    enrich[id] = result;
    checkpoint.enrich = enrich;
    checkpoint.enrichSavedAt = now.toISOString();
    await save();
  }
  checkpoint.enrich = enrich;
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
  now: Date
): Promise<boolean> {
  const updatedAt = now.toISOString();
  const catalog: Record<string, unknown>[] = [];
  const contacts: Record<string, unknown>[] = [];
  for (const show of shows) {
    const decision = keepOf(show, floor);
    if (!decision.kept || !decision.reason) continue;
    const enrich = checkpoint.enrich?.[show.candidate.podcastId];
    const showId = links.links.get(show.candidate.podcastId) ?? null;
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
        demographics: enrich?.demographics ?? null,
        listener: enrich?.listener ?? show.candidate.listenerEngagement,
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
      1000: planFloor(kept[1000], enrich, args.maxPodscanCalls),
      2500: planFloor(kept[2500], enrich, args.maxPodscanCalls),
      5000: planFloor(kept[5000], enrich, args.maxPodscanCalls),
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

function planFloor(
  shows: WorkingShow[],
  enrich: Record<string, EnrichProgress>,
  budget: number
): { calls: number; days: number } {
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
