import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCheckpoint } from "./checkpoint";
import { HostLimiter } from "./rate-limit";
import { parseArgs, runImport, type Db, type PodscanCaller, type RunDeps, type ShowLink } from "./run";

const FIXTURE_EMAIL = "owner@sponsor.example";
const HIDDEN_EMAIL = "hidden@sponsor.example";
const FEED_EMAIL = "itunes-owner@sponsor.example";
const API_KEY = "podscan-test-key-should-not-leak";
const SERVICE_KEY = "service-role-test-key-should-not-leak";

const dirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "podscan-run-"));
  dirs.push(dir);
  return dir;
}

function fastLimiter(): HostLimiter {
  return new HostLimiter(100_000, 8, () => Date.now(), async () => {});
}

interface Hit {
  id: string;
  audience: number | null;
  email: string | null;
  itunes: string | null;
  rss: string | null;
  hasSponsors: boolean;
}

function hit(partial: Hit): Hit {
  return partial;
}

function podcastBody(row: Hit): Record<string, unknown> {
  return {
    podcast_id: row.id,
    podcast_name: row.id,
    podcast_categories: ["News"],
    podcast_has_sponsors: row.hasSponsors,
    podcast_itunes_id: row.itunes ?? undefined,
    rss_url: row.rss ?? undefined,
    listener_engagement: { total_listeners: 4 },
    reach: {
      audience_size: row.audience,
      email: row.email,
      website: null,
      social_links: [],
      itunes: [],
      spotify: [],
      feed_email: HIDDEN_EMAIL,
    },
  };
}

function makeCaller(sponsored: Hit[], unsponsored: Hit[], failDaily = false) {
  const calls: string[] = [];
  const posts: Array<Record<string, unknown>> = [];
  let remaining = 100;
  const caller: PodscanCaller = {
    async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
      calls.push(`GET ${path}`);
      remaining = Math.max(0, remaining - 1);
      if (failDaily) {
        throw Object.assign(new Error(`daily quota ${API_KEY} ${FIXTURE_EMAIL}`), {
          status: 429,
          retryAfter: 7200,
          rateLimitRemaining: 0,
        });
      }
      if (path === "/podcasts/search") {
        const rows = params?.has_sponsors === true ? sponsored : unsponsored;
        return {
          podcasts: rows.map(podcastBody),
          pagination: {
            total: rows.length,
            per_page: 50,
            current_page: 1,
            last_page: 1,
            from: rows.length ? 1 : null,
            to: rows.length ? rows.length : null,
          },
        } as T;
      }
      if (path.endsWith("/demographics")) return { ok: true } as T;
      if (path.endsWith("/latest/sponsor")) return { posted_at: "2026-11-01T00:00:00.000Z" } as T;
      throw Object.assign(new Error(SERVICE_KEY), { status: 404 });
    },
    async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
      calls.push(`POST ${path}`);
      posts.push(body);
      remaining = Math.max(0, remaining - 1);
      const ids = Array.isArray(body.podcast_ids) ? body.podcast_ids.map(String) : [];
      const sponsoredIds = new Set(sponsored.map((row) => row.id));
      const results: Record<string, string | null> = {};
      for (const id of ids) results[id] = sponsoredIds.has(id) ? `ep_${id}` : null;
      return { results } as T;
    },
    rateLimit: () => ({ limit: 120, remaining }),
  };
  return { caller, calls, posts };
}

function memoryDb(shows: ShowLink[], missing = false) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    shows: shows.map((row) => ({ ...row })),
    podscan_catalog: [],
    show_contacts: [],
  };
  const upserts: Array<{ table: string; onConflict: string; rows: Record<string, unknown>[] }> = [];
  const db: Db = {
    from(table: string) {
      return {
        select() {
          return {
            async limit() {
              if (missing && table !== "shows") return { data: null, error: { code: "42P01" } };
              return { data: [], error: null };
            },
            async in(column, values) {
              const rows = (tables[table] ?? []).filter((row) =>
                values.includes(String(row[column] ?? ""))
              );
              return { data: rows as unknown as ShowLink[], error: null };
            },
          };
        },
        async upsert(rows, options) {
          upserts.push({ table, onConflict: options.onConflict, rows });
          const keys = options.onConflict.split(",").map((key) => key.trim());
          const existing = tables[table] ?? [];
          for (const row of rows) {
            const idx = existing.findIndex((item) => keys.every((key) => item[key] === row[key]));
            if (idx === -1) existing.push({ ...row });
            else existing[idx] = { ...existing[idx], ...row };
          }
          tables[table] = existing;
          return { data: null, error: null };
        },
      };
    },
  };
  return { db, tables, upserts };
}

function deps(dir: string, caller: PodscanCaller, db: Db | null): RunDeps {
  return {
    caller,
    db,
    checkpointDir: dir,
    now: () => new Date("2026-11-17T12:00:00.000Z"),
    sleepFn: async () => {},
    rng: () => 0,
    podscanLimiter: fastLimiter(),
    appleLimiter: fastLimiter(),
    lookup: async () => ["1.1.1.1"],
    dns: {
      resolveMx: async () => [{ exchange: "mx.sponsor.example", priority: 1 }],
      resolve4: async () => ["1.1.1.1"],
      resolve6: async () => [],
    },
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("itunes.apple.com")) {
        const ids = new URL(url).searchParams.get("id")?.split(",") ?? [];
        return new Response(
          JSON.stringify({
            resultCount: ids.length,
            results: ids.map((id) => ({
              collectionId: Number(id),
              feedUrl: `https://feeds.example.test/${id}.xml`,
            })),
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        `<rss><channel><itunes:owner><itunes:email>${FEED_EMAIL}</itunes:email></itunes:owner></channel></rss>`,
        { status: 200 }
      );
    },
  };
}

function spyLogs(): string[] {
  const lines: string[] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
    });
  }
  return lines;
}

function assertNoSecrets(text: string): void {
  expect(text).not.toContain("@");
  expect(text).not.toContain(API_KEY);
  expect(text).not.toContain(SERVICE_KEY);
  expect(text).not.toContain(FIXTURE_EMAIL);
  expect(text).not.toContain(HIDDEN_EMAIL);
  expect(text).not.toContain(FEED_EMAIL);
}

const sponsoredTwenty: Hit[] = Array.from({ length: 20 }, (_, index) =>
  hit({
    id: `sp_${String(index).padStart(2, "0")}`,
    audience: 1000 + index,
    email: `  ${FIXTURE_EMAIL.toUpperCase()} `,
    itunes: String(3000 + index),
    rss: `https://rss.example.test/${index}.xml`,
    hasSponsors: true,
  })
);

const oneFloor: Hit[] = [
  hit({
    id: "un_z",
    audience: 4000,
    email: null,
    itunes: "3999",
    rss: "https://rss.example.test/z.xml",
    hasSponsors: false,
  }),
];

describe("runImport", () => {
  it("refuses a write before any Podscan call when the flags are wrong", async () => {
    const dir = await tempDir();
    const logs = spyLogs();
    const world = makeCaller(sponsoredTwenty, oneFloor);
    const base = deps(dir, world.caller, null);
    expect((await runImport(parseArgs(["--commit", "--dry-run"]), base)).exitCode).toBe(1);
    expect((await runImport(parseArgs(["--commit", "--sample", "25", "--floor", "1000", "--confirm", "1"]), base)).exitCode).toBe(1);
    expect((await runImport(parseArgs(["--commit", "--confirm", "1"]), base)).exitCode).toBe(1);
    expect((await runImport(parseArgs(["--commit", "--floor", "1000"]), base)).exitCode).toBe(1);
    expect(world.calls).toEqual([]);
    expect(logs.join("\n")).toContain("Pass either --commit or --dry-run.");
    expect(logs.join("\n")).toContain("Refusing to write a sample. Run --commit without --sample.");
    expect(logs.join("\n")).toContain("Refusing to write without --floor.");
    expect(logs.join("\n")).toContain("Refusing to write without --confirm.");
    assertNoSecrets(logs.join("\n"));
  });

  it("prints the three proof lines and writes a report with no email", async () => {
    const dir = await tempDir();
    const logs = spyLogs();
    const world = makeCaller(sponsoredTwenty, oneFloor);
    const store = memoryDb([
      { id: "show_0", podscan_id: "sp_00" },
      { id: "show_1a", podscan_id: "sp_01" },
      { id: "show_1b", podscan_id: "sp_01" },
    ]);
    const result = await runImport(parseArgs(["--dry-run", "--sample", "25"]), deps(dir, world.caller, store.db));
    expect(result.exitCode).toBe(0);
    const text = logs.join("\n");
    expect(text).toContain("DEMOGRAPHICS: PASS");
    expect(text).toContain("LISTENER DATA: PASS");
    expect(text).toContain("SPONSOR PROBE: PASS");
    expect(text).toContain("This sample is not the catalog.");
    assertNoSecrets(text);
    expect(world.calls.includes("GET /podcasts/sp_00")).toBe(false);
    expect(world.calls.filter((call) => call.includes("/demographics"))).toHaveLength(5);
    expect(world.posts[0]).toMatchObject({
      has_sponsors: true,
      active_within_days: 365,
      episodes_to_check: 25,
    });
    expect(store.upserts).toEqual([]);
    const names = await readdir(dir);
    const reportName = names.find((name) => name.startsWith("report-") && name.endsWith(".json"));
    expect(reportName).toBeTruthy();
    const report = await readFile(join(dir, reportName ?? ""), "utf8");
    const markdown = await readFile(join(dir, (reportName ?? "").replace(/\.json$/, ".md")), "utf8");
    assertNoSecrets(report);
    assertNoSecrets(markdown);
    expect(report).not.toContain("http");
    expect(report).toContain("\"alreadyInShows\"");
    const parsed = JSON.parse(report) as { alreadyInShows: { 1000: number } };
    expect(parsed.alreadyInShows[1000]).toBe(2);
  });

  it("refuses a missing migration, a wrong confirm, and then upserts once", async () => {
    const dir = await tempDir();
    const logs = spyLogs();
    const sponsored = [
      hit({
        id: "sp_a",
        audience: 100,
        email: ` ${FIXTURE_EMAIL.toUpperCase()} `,
        itunes: "1001",
        rss: "https://rss.example.test/a.xml",
        hasSponsors: true,
      }),
      hit({
        id: "sp_b",
        audience: null,
        email: FIXTURE_EMAIL,
        itunes: "1002",
        rss: null,
        hasSponsors: true,
      }),
    ];
    const unsponsored = [
      hit({
        id: "un_c",
        audience: 3000,
        email: null,
        itunes: null,
        rss: "https://rss.example.test/c.xml",
        hasSponsors: false,
      }),
      hit({
        id: "un_d",
        audience: 800,
        email: FIXTURE_EMAIL,
        itunes: null,
        rss: null,
        hasSponsors: false,
      }),
    ];
    const world = makeCaller(sponsored, unsponsored);
    const missing = memoryDb([], true);
    const refused = await runImport(
      parseArgs(["--commit", "--floor", "1000", "--confirm", "3"]),
      deps(dir, world.caller, missing.db)
    );
    expect(refused.exitCode).toBe(1);
    expect(logs.join("\n")).toContain("Migration 093 is not applied.");
    expect(missing.upserts).toEqual([]);
    expect(world.calls).toEqual([]);

    const wrong = memoryDb([], false);
    const wrongLogs = spyLogs();
    const wrongRun = await runImport(
      parseArgs(["--commit", "--floor", "1000", "--confirm", "1"]),
      deps(dir, world.caller, wrong.db)
    );
    expect(wrongRun.exitCode).toBe(1);
    expect(wrongLogs.join("\n")).toContain(
      "Refusing to write. --confirm must equal the kept count for this floor (3)."
    );
    expect(wrong.upserts).toEqual([]);

    const store = memoryDb([
      { id: "show_a", podscan_id: "sp_a" },
      { id: "show_b1", podscan_id: "sp_b" },
      { id: "show_b2", podscan_id: "sp_b" },
    ]);
    const wrote = await runImport(
      parseArgs(["--commit", "--floor", "1000", "--confirm", "3"]),
      deps(dir, world.caller, store.db)
    );
    expect(wrote.exitCode).toBe(0);
    expect(store.upserts.map((item) => item.onConflict)).toEqual(["podscan_id", "podscan_id,source,email"]);
    expect(store.tables.podscan_catalog).toHaveLength(3);
    expect(store.tables.show_contacts).toHaveLength(5);
    const catalogA = store.tables.podscan_catalog.find((row) => row.podscan_id === "sp_a");
    const catalogB = store.tables.podscan_catalog.find((row) => row.podscan_id === "sp_b");
    expect(catalogA?.show_id).toBe("show_a");
    expect(catalogB?.show_id).toBeNull();
    expect(catalogA?.latest_sponsored_at).toBe("2026-11-01T00:00:00.000Z");
    expect(catalogA).not.toHaveProperty("imported_at");
    expect(catalogA).not.toHaveProperty("id");
    expect(JSON.stringify(store.tables)).not.toContain(HIDDEN_EMAIL);
    expect(JSON.stringify(store.tables.show_contacts)).toContain(FIXTURE_EMAIL);
    expect(JSON.stringify(store.tables.show_contacts)).not.toContain(FIXTURE_EMAIL.toUpperCase());
    const before = JSON.stringify(store.tables.podscan_catalog);
    const callsBefore = world.calls.length;
    const file = join(dir, "checkpoint.json");
    const saved = JSON.parse(await readFile(file, "utf8")) as {
      searchSavedAt?: string;
      probeSavedAt?: string;
      contactsSavedAt?: string;
    };
    saved.searchSavedAt = "2026-11-01T00:00:00.000Z";
    saved.probeSavedAt = "2026-11-01T00:00:00.000Z";
    saved.contactsSavedAt = "2026-11-01T00:00:00.000Z";
    await writeFile(file, JSON.stringify(saved), "utf8");
    const again = await runImport(
      parseArgs(["--commit", "--floor", "1000", "--confirm", "3"]),
      deps(dir, world.caller, store.db)
    );
    expect(again.exitCode).toBe(0);
    expect(store.tables.podscan_catalog).toHaveLength(3);
    expect(store.tables.show_contacts).toHaveLength(5);
    expect(JSON.stringify(store.tables.podscan_catalog)).toBe(before);
    expect(world.calls.length).toBe(callsBefore);
    assertNoSecrets(logs.join("\n") + wrongLogs.join("\n"));
  });

  it("stops on the daily limit, saves the checkpoint, and does not print the error body", async () => {
    const dir = await tempDir();
    const logs = spyLogs();
    const world = makeCaller(sponsoredTwenty, oneFloor, true);
    const result = await runImport(parseArgs(["--dry-run", "--sample", "25"]), deps(dir, world.caller, null));
    expect(result.exitCode).toBe(0);
    expect(logs.join("\n")).toContain(
      "Daily Podscan limit reached. Re-run the same command tomorrow to resume."
    );
    assertNoSecrets(logs.join("\n"));
    const saved = await readCheckpoint(join(dir, "checkpoint.json"));
    expect(saved.version).toBe(1);
  });

  it("refetches candidate data older than 7 days", async () => {
    const dir = await tempDir();
    spyLogs();
    const world = makeCaller(sponsoredTwenty, oneFloor);
    const first = await runImport(parseArgs(["--dry-run", "--sample", "25"]), deps(dir, world.caller, null));
    expect(first.exitCode).toBe(0);
    const file = join(dir, "checkpoint.json");
    const checkpoint = JSON.parse(await readFile(file, "utf8")) as { searchSavedAt?: string };
    checkpoint.searchSavedAt = "2026-11-01T00:00:00.000Z";
    await writeFile(file, JSON.stringify(checkpoint), "utf8");
    const before = world.calls.filter((call) => call === "GET /podcasts/search").length;
    const second = await runImport(parseArgs(["--dry-run", "--sample", "25"]), deps(dir, world.caller, null));
    expect(second.exitCode).toBe(0);
    const after = world.calls.filter((call) => call === "GET /podcasts/search").length;
    expect(after).toBeGreaterThan(before);
  });

  it("upserts enriched shows when the budget stops and finishes them on the next run", async () => {
    const dir = await tempDir();
    const logs = spyLogs();
    const shows = [
      hit({
        id: "sp_hi",
        audience: 400,
        email: FIXTURE_EMAIL,
        itunes: "11",
        rss: "https://rss.example.test/hi.xml",
        hasSponsors: true,
      }),
      hit({
        id: "sp_mid",
        audience: 300,
        email: FIXTURE_EMAIL,
        itunes: "12",
        rss: "https://rss.example.test/mid.xml",
        hasSponsors: true,
      }),
      hit({
        id: "sp_lo",
        audience: 200,
        email: FIXTURE_EMAIL,
        itunes: "13",
        rss: "https://rss.example.test/lo.xml",
        hasSponsors: true,
      }),
      hit({
        id: "sp_min",
        audience: 100,
        email: FIXTURE_EMAIL,
        itunes: "14",
        rss: "https://rss.example.test/min.xml",
        hasSponsors: true,
      }),
    ];
    const world = makeCaller(shows, []);
    const store = memoryDb([]);
    const args = parseArgs(["--commit", "--floor", "1000", "--confirm", "4", "--max-podscan-calls", "9"]);
    const stopped = await runImport(args, deps(dir, world.caller, store.db));
    expect(stopped.exitCode).toBe(0);
    expect(logs.join("\n")).toContain("Upserted 2 of 4. Re-run the same command to continue.");
    expect(store.tables.podscan_catalog.map((row) => row.podscan_id).sort()).toEqual(["sp_hi", "sp_mid"]);
    expect(store.upserts.map((item) => item.onConflict)).toEqual(["podscan_id", "podscan_id,source,email"]);
    const contactKeys = () =>
      store.tables.show_contacts.map((row) => `${row.podscan_id}|${row.source}|${row.email}`);
    expect(new Set(contactKeys()).size).toBe(contactKeys().length);
    const afterStop = contactKeys().length;

    const finished = await runImport(args, deps(dir, world.caller, store.db));
    expect(finished.exitCode).toBe(0);
    expect(store.tables.podscan_catalog.map((row) => row.podscan_id).sort()).toEqual([
      "sp_hi",
      "sp_lo",
      "sp_mid",
      "sp_min",
    ]);
    expect(new Set(contactKeys()).size).toBe(contactKeys().length);
    expect(contactKeys().length).toBeGreaterThan(afterStop);
    assertNoSecrets(logs.join("\n"));
  });

  it("starts a full dry run over when the checkpoint came from a sample", async () => {
    const dir = await tempDir();
    const logs = spyLogs();
    const sponsored = Array.from({ length: 30 }, (_, index) =>
      hit({
        id: `sp_${String(index).padStart(2, "0")}`,
        audience: 2000,
        email: FIXTURE_EMAIL,
        itunes: String(5000 + index),
        rss: `https://rss.example.test/${index}.xml`,
        hasSponsors: true,
      })
    );
    const world = makeCaller(sponsored, []);
    const first = await runImport(parseArgs(["--dry-run", "--sample", "25"]), deps(dir, world.caller, null));
    expect(first.exitCode).toBe(0);
    const saved = await readCheckpoint(join(dir, "checkpoint.json"));
    expect(saved.sample).toBe(25);
    expect(saved.search?.passCounts.sponsored).toBe(25);
    const searches = () => world.calls.filter((call) => call === "GET /podcasts/search").length;
    const afterSample = searches();
    const again = await runImport(parseArgs(["--dry-run", "--sample", "25"]), deps(dir, world.caller, null));
    expect(again.exitCode).toBe(0);
    expect(searches()).toBe(afterSample);
    const full = await runImport(parseArgs(["--dry-run"]), deps(dir, world.caller, null));
    expect(full.exitCode).toBe(0);
    expect(searches()).toBeGreaterThan(afterSample);
    expect(logs.join("\n")).toContain("Checkpoint sample does not match this run. Starting the search over.");
    expect(logs.join("\n")).toContain("Candidates sponsored pass: 30");
    const after = await readCheckpoint(join(dir, "checkpoint.json"));
    expect(after.sample).toBeNull();
    expect(after.search?.passCounts.sponsored).toBe(30);
    expect(after.search?.rows.some((row) => row.podcastId === "sp_29")).toBe(true);
    assertNoSecrets(logs.join("\n"));
  });

  it("does not commit the sample shows when the checkpoint was a sample", async () => {
    const dir = await tempDir();
    spyLogs();
    const sponsored = Array.from({ length: 30 }, (_, index) =>
      hit({
        id: `sp_${String(index).padStart(2, "0")}`,
        audience: 2000,
        email: FIXTURE_EMAIL,
        itunes: String(6000 + index),
        rss: `https://rss.example.test/c${index}.xml`,
        hasSponsors: true,
      })
    );
    const world = makeCaller(sponsored, []);
    const sample = await runImport(parseArgs(["--dry-run", "--sample", "25"]), deps(dir, world.caller, null));
    expect(sample.exitCode).toBe(0);
    const store = memoryDb([]);
    const wrote = await runImport(
      parseArgs(["--commit", "--floor", "1000", "--confirm", "30"]),
      deps(dir, world.caller, store.db)
    );
    expect(wrote.exitCode).toBe(0);
    const ids = store.tables.podscan_catalog.map((row) => row.podscan_id);
    expect(ids).toHaveLength(30);
    expect(ids).toContain("sp_25");
    expect(ids).toContain("sp_29");
    expect(store.upserts.map((item) => item.onConflict)).toEqual(["podscan_id", "podscan_id,source,email"]);
  });

  it("continues without category slicing when categories fails, and the log has no email or key", async () => {
    const dir = await tempDir();
    const logs = spyLogs();
    const searches: Array<Record<string, string | number | boolean | undefined>> = [];
    const caller = cappedCaller(searches, () => {
      throw new TypeError(
        `Unexpected token < in JSON at position 0 ${FIXTURE_EMAIL} ${API_KEY} ${SERVICE_KEY} https://podscan.fm/api/v1/categories?api_key=${API_KEY}`
      );
    });
    const result = await runImport(parseArgs(["--dry-run"]), deps(dir, caller, null));
    expect(result.exitCode).toBe(0);
    const text = logs.join("\n");
    expect(text).toContain("podscan-import failed step=categories name=TypeError reason=");
    expect(text).toContain("Unexpected token < in JSON at position 0");
    expect(text.match(/step=categories/g)).toHaveLength(1);
    assertNoSecrets(text);
    expect(text).not.toContain("http");
    expect(text).not.toContain("?");
    expect(searches.some((params) => params.category_ids != null)).toBe(false);
  });

  it("slices with the documented categories body and logs an unexpected body once", async () => {
    const documented = {
      categories: [
        {
          category_id: "ct_akrev35b2454ypql",
          category_name: "health",
          category_display_name: "Health",
        },
      ],
    };
    const dir = await tempDir();
    const logs = spyLogs();
    const searches: Array<Record<string, string | number | boolean | undefined>> = [];
    const ok = await runImport(
      parseArgs(["--dry-run"]),
      deps(dir, cappedCaller(searches, () => documented), null)
    );
    expect(ok.exitCode).toBe(0);
    expect(searches.some((params) => params.category_ids === "ct_akrev35b2454ypql")).toBe(true);
    expect(logs.join("\n")).not.toContain("step=categories");

    const badDir = await tempDir();
    const badLogs = spyLogs();
    const badSearches: Array<Record<string, string | number | boolean | undefined>> = [];
    const bad = await runImport(
      parseArgs(["--dry-run"]),
      deps(badDir, cappedCaller(badSearches, () => ({ categories: { health: { category_id: "ct_hidden" } } })), null)
    );
    expect(bad.exitCode).toBe(0);
    const badText = badLogs.join("\n");
    expect(badText).toContain("step=categories name=TypeError reason=unexpected categories shape");
    expect(badText.match(/step=categories/g)).toHaveLength(1);
    expect(badText).not.toContain("ct_hidden");
    expect(badSearches.some((params) => params.category_ids != null)).toBe(false);
    assertNoSecrets(badText);
  });

  it("still stops for a daily limit raised by the categories call", async () => {
    const dir = await tempDir();
    const logs = spyLogs();
    const searches: Array<Record<string, string | number | boolean | undefined>> = [];
    const caller = cappedCaller(searches, () => {
      throw Object.assign(new Error(`daily quota ${API_KEY} ${FIXTURE_EMAIL}`), {
        status: 429,
        retryAfter: 7200,
        rateLimitRemaining: 0,
      });
    });
    const result = await runImport(parseArgs(["--dry-run"]), deps(dir, caller, null));
    expect(result.exitCode).toBe(0);
    const text = logs.join("\n");
    expect(text).toContain("Daily Podscan limit reached. Re-run the same command tomorrow to resume.");
    expect(text).not.toContain("step=categories");
    assertNoSecrets(text);
  });

  it("retries a terminated search and then finishes", async () => {
    const dir = await tempDir();
    const logs = spyLogs();
    const world = makeCaller(sponsoredTwenty, oneFloor);
    const flaky = failSearches(world.caller, 1);
    const result = await runImport(parseArgs(["--dry-run", "--sample", "25"]), deps(dir, flaky.caller, null));
    expect(result.exitCode).toBe(0);
    expect(flaky.searches()).toBeGreaterThan(1);
    expect(logs.join("\n")).toContain("Sample: 25");
    assertNoSecrets(logs.join("\n"));
  });

  it("saves the checkpoint when a terminated search keeps failing", async () => {
    const dir = await tempDir();
    const logs = spyLogs();
    const world = makeCaller(sponsoredTwenty, oneFloor);
    const flaky = failSearches(world.caller, 20);
    const result = await runImport(parseArgs(["--dry-run", "--sample", "25"]), deps(dir, flaky.caller, null));
    expect(result.exitCode).toBe(1);
    expect(flaky.searches()).toBe(5);
    const text = logs.join("\n");
    expect(text).toContain("podscan-import failed step=search name=TypeError reason=terminated");
    assertNoSecrets(text);
    const saved = await readCheckpoint(join(dir, "checkpoint.json"));
    expect(saved.version).toBe(1);
    expect(saved.sample).toBe(25);
    expect(saved.search?.started).toBe(true);
    expect(saved.search?.complete).toBe(false);
  });
});

function failSearches(inner: PodscanCaller, failCount: number): { caller: PodscanCaller; searches: () => number } {
  let searches = 0;
  return {
    searches: () => searches,
    caller: {
      async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
        if (path === "/podcasts/search") {
          searches += 1;
          if (searches <= failCount) {
            throw Object.assign(new TypeError(`terminated ${FIXTURE_EMAIL} ${API_KEY}`), {
              cause: Object.assign(new Error("socket hang up"), { code: "UND_ERR_SOCKET" }),
            });
          }
        }
        return inner.get(path, params);
      },
      post: (path, body) => inner.post(path, body),
      rateLimit: () => inner.rateLimit(),
    },
  };
}

function cappedCaller(
  searches: Array<Record<string, string | number | boolean | undefined>>,
  categories: () => unknown
): PodscanCaller {
  let remaining = 100;
  return {
    async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
      remaining = Math.max(0, remaining - 1);
      if (path === "/categories") return categories() as T;
      if (path === "/podcasts/search") {
        searches.push(params ?? {});
        const broad =
          params?.has_sponsors === true && params.category_ids == null && params.min_audience_size == null;
        if (broad) {
          return {
            podcasts: [],
            pagination: { total: 10000, per_page: 50, current_page: 1, last_page: 200, from: null, to: null },
          } as T;
        }
        const id = `pd_${String(params?.category_ids ?? params?.min_audience_size ?? "u")}`;
        return {
          podcasts: [
            {
              podcast_id: id,
              podcast_name: id,
              podcast_categories: ["News"],
              listener_engagement: { total_listeners: 1 },
              reach: {
                audience_size: 2000,
                email: null,
                website: null,
                social_links: [],
                itunes: [],
                spotify: [],
              },
            },
          ],
          pagination: { total: 1, per_page: 50, current_page: 1, last_page: 1, from: 1, to: 1 },
        } as T;
      }
      if (path.endsWith("/latest/sponsor")) return { posted_at: "2026-11-01T00:00:00.000Z" } as T;
      if (path.endsWith("/demographics")) return { ok: true } as T;
      throw Object.assign(new Error("missing"), { status: 404 });
    },
    async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
      remaining = Math.max(0, remaining - 1);
      const ids = Array.isArray(body.podcast_ids) ? body.podcast_ids.map(String) : [];
      const results: Record<string, string | null> = {};
      for (const id of ids) results[id] = null;
      return { results } as T;
    },
    rateLimit: () => ({ limit: 120, remaining }),
  };
}
