import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogCandidate } from "./candidates";
import { readCheckpoint } from "./checkpoint";
import { HostLimiter, TRANSIENT_ATTEMPTS } from "./rate-limit";
import { parseArgs, runImport, type PodscanCaller, type RunDeps } from "./run";

const dirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "podscan-probe-"));
  dirs.push(dir);
  return dir;
}

function fastLimiter(): HostLimiter {
  return new HostLimiter(100_000, 8, () => Date.now(), async () => {});
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

function timeoutErr(): Error {
  const err = new Error("Podscan API timeout");
  err.name = "PodscanApiError";
  return err;
}

function statusErr(status: number, message: string): Error {
  const err = new Error(message);
  err.name = "PodscanApiError";
  return Object.assign(err, { status });
}

function row(id: string): CatalogCandidate {
  return {
    podcastId: id,
    name: id,
    itunesId: null,
    rssUrl: null,
    hasSponsors: false,
    audienceSize: 2000,
    podscanEmail: null,
    language: "en",
    region: null,
    categories: [],
    lastPostedAt: null,
    episodeCount: null,
    listenerEngagement: null,
    pass: "unsponsored",
  };
}

function searchBody(ids: readonly string[]): Record<string, unknown> {
  return {
    podcasts: ids.map((id) => ({
      podcast_id: id,
      podcast_name: id,
      podcast_has_sponsors: false,
      reach: { audience_size: 2000, email: null },
      listener_engagement: { total_listeners: 4 },
    })),
    pagination: {
      total: ids.length,
      per_page: 50,
      current_page: 1,
      last_page: 1,
    },
  };
}

function deps(dir: string, caller: PodscanCaller): RunDeps {
  return {
    caller,
    db: null,
    checkpointDir: dir,
    now: () => new Date("2026-11-17T12:00:00.000Z"),
    sleepFn: async () => {},
    rng: () => 0,
    podscanLimiter: fastLimiter(),
    appleLimiter: fastLimiter(),
    lookup: async () => {
      throw new Error("network");
    },
    dns: {
      resolveMx: async () => {
        throw new Error("network");
      },
      resolve4: async () => {
        throw new Error("network");
      },
      resolve6: async () => {
        throw new Error("network");
      },
    },
    fetchImpl: async () => {
      throw new Error("network");
    },
  };
}

function callsUsed(text: string): number {
  const match = text.match(/Podscan calls used: (\d+)/);
  expect(match).toBeTruthy();
  return Number(match?.[1]);
}

function idsOf(body: Record<string, unknown>): string[] {
  return Array.isArray(body.podcast_ids) ? body.podcast_ids.map(String) : [];
}

describe("probe split", () => {
  it("splits a timed-out chunk, saves each half, and counts every call", async () => {
    await expectSplit("timeout");
  });

  it("splits a 5xx chunk the same way", async () => {
    await expectSplit("503");
  });

  it("keeps a single timed-out id out of probe until latest/sponsor resolves it", async () => {
    const dir = await tempDir();
    const logs = spyLogs();
    const file = join(dir, "checkpoint.json");
    const posts: string[][] = [];
    const calls: string[] = [];
    const gaps: Array<{ probe?: Record<string, string | null>; probeFailed?: string[] }> = [];
    const caller: PodscanCaller = {
      async get(path, params) {
        calls.push(`GET ${path}`);
        if (path === "/podcasts/search") {
          const ids = params?.has_sponsors === true ? [] : ["bad_show", "good_show"];
          return searchBody(ids) as never;
        }
        if (path === "/podcasts/bad_show/latest/sponsor") {
          gaps.push(JSON.parse(await readFile(file, "utf8")) as {
            probe?: Record<string, string | null>;
            probeFailed?: string[];
          });
          return { episode_id: "ep_bad_show", posted_at: "2026-11-01T00:00:00.000Z" } as never;
        }
        throw statusErr(404, "missing");
      },
      async post(_path, body) {
        calls.push("POST /podcasts/batch-probe");
        const ids = idsOf(body);
        posts.push(ids);
        if (ids.includes("bad_show")) throw timeoutErr();
        const results: Record<string, string | null> = {};
        for (const id of ids) results[id] = `ep_${id}`;
        return { results } as never;
      },
      rateLimit: () => ({ limit: 120, remaining: 100 }),
    };
    const result = await runImport(parseArgs(["--dry-run", "--sample", "25", "--no-enrich"]), deps(dir, caller));
    expect(result.exitCode).toBe(0);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.probe?.bad_show).toBeUndefined();
    expect(gaps[0]?.probe?.good_show).toBe("ep_good_show");
    expect(gaps[0]?.probeFailed).toEqual(["bad_show"]);
    expect(posts.filter((ids) => ids.length === 1).every((ids) => ids[0] === "bad_show" || ids[0] === "good_show")).toBe(
      true
    );
    expect(posts.some((ids) => ids.length === 1 && ids[0] === "good_show")).toBe(true);
    const saved = await readCheckpoint(file);
    expect(saved.probe?.bad_show).toBe("ep_bad_show");
    expect(saved.probe?.good_show).toBe("ep_good_show");
    expect(saved.probeFailed).toEqual([]);
    const text = logs.join("\n");
    expect(text).toContain("Probe failed shows: 0");
    expect(text).not.toContain("podscan-import failed step=probe");
    expect(callsUsed(text)).toBe(calls.length);
    expect(calls.filter((call) => call.startsWith("POST")).length).toBe(TRANSIENT_ATTEMPTS * 2 + 1);
  });

  it("treats a 404 from latest/sponsor as no sponsor", async () => {
    const saved = await runFallback("404");
    expect(saved.probe?.bad_show).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(saved.probe, "bad_show")).toBe(true);
    expect(saved.probeFailed).toEqual([]);
    expect(saved.text).toContain("Probe failed shows: 0");
    expect(saved.sponsorGets).toBe(1);
  });

  it("leaves a single id in probeFailed when the fallback still fails", async () => {
    const saved = await runFallback("timeout");
    expect(saved.probe?.bad_show).toBeUndefined();
    expect(saved.probe?.good_show).toBe("ep_good_show");
    expect(saved.probeFailed).toEqual(["bad_show"]);
    expect(saved.exitCode).toBe(0);
    expect(saved.text).toContain("Probe failed shows: 1");
    expect(saved.text).not.toContain("podscan-import failed step=probe");
    expect(saved.sponsorGets).toBe(TRANSIENT_ATTEMPTS);
    expect(callsUsed(saved.text)).toBe(saved.calls);
  });

  it("does not split a 429 and stops the run", async () => {
    const run = await runStop(
      () =>
        Object.assign(new Error("slow down"), {
          name: "PodscanApiError",
          status: 429,
          retryAfter: 1,
          rateLimitRemaining: 10,
        }),
      ["--dry-run", "--sample", "25", "--no-enrich"]
    );
    expect(run.exitCode).toBe(1);
    expect(run.posts.every((ids) => ids.length === 2)).toBe(true);
    expect(run.posts.length).toBe(TRANSIENT_ATTEMPTS);
    expect(run.text).toContain("podscan-import failed step=probe");
    expect(run.text).toContain("status=429");
    expect(run.saved.probeFailed).toBeUndefined();
  });

  it("does not split a daily PodscanStop", async () => {
    const run = await runStop(
      () =>
        Object.assign(new Error("daily quota"), {
          name: "PodscanApiError",
          status: 429,
          retryAfter: 7200,
          rateLimitRemaining: 0,
        }),
      ["--dry-run", "--sample", "25", "--no-enrich"]
    );
    expect(run.exitCode).toBe(0);
    expect(run.posts).toEqual([["id_a", "id_b"]]);
    expect(run.text).toContain("Daily Podscan limit reached. Re-run the same command tomorrow to resume.");
    expect(run.text).not.toContain("podscan-import failed step=probe");
    expect(run.saved.probe?.id_a).toBeUndefined();
    expect(run.saved.probeFailed).toBeUndefined();
  });

  it("does not split when the call budget throws PodscanStop", async () => {
    const run = await runStop(() => timeoutErr(), ["--dry-run", "--sample", "25", "--no-enrich", "--max-podscan-calls", "7"]);
    expect(run.exitCode).toBe(0);
    expect(run.posts.every((ids) => ids.length === 2)).toBe(true);
    expect(run.posts.length).toBe(TRANSIENT_ATTEMPTS);
    expect(run.text).toContain("Podscan call budget reached. Re-run the same command to resume.");
    expect(run.text).not.toContain("podscan-import failed step=probe");
    expect(run.saved.probe?.id_a).toBeUndefined();
    expect(run.saved.probeFailed).toBeUndefined();
  });

  it("does not split a dropped connection that is not a timeout", async () => {
    const run = await runStop(() => new TypeError("fetch failed"), ["--dry-run", "--sample", "25", "--no-enrich"]);
    expect(run.exitCode).toBe(1);
    expect(run.posts.every((ids) => ids.length === 2)).toBe(true);
    expect(run.posts.length).toBe(TRANSIENT_ATTEMPTS);
    expect(run.text).toContain("podscan-import failed step=probe");
    expect(run.saved.probeFailed).toBeUndefined();
  });

  it("does not split a 4xx other than 429", async () => {
    const run = await runStop(() => statusErr(400, "bad request"), ["--dry-run", "--sample", "25", "--no-enrich"]);
    expect(run.exitCode).toBe(1);
    expect(run.posts).toEqual([["id_a", "id_b"]]);
    expect(run.text).toContain("podscan-import failed step=probe");
    expect(run.text).toContain("status=400");
    expect(run.saved.probeFailed).toBeUndefined();
  });

  it("skips ids already probed and retries a deduped probeFailed list", async () => {
    const dir = await tempDir();
    const logs = spyLogs();
    const file = join(dir, "checkpoint.json");
    const kept = "kept_show";
    const retry = "retry_show";
    const fresh = "fresh_show";
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        sample: null,
        searchSavedAt: "2026-11-01T00:00:00.000Z",
        search: {
          started: true,
          complete: true,
          queue: [],
          rows: [row(kept), row(retry), row(fresh)],
          passCounts: { sponsored: 0, unsponsored: 3 },
          cappedSlices: [],
        },
        probeSavedAt: "2026-11-01T00:00:00.000Z",
        probe: { [kept]: "ep_kept" },
        probeFailed: [retry, retry],
      }),
      "utf8"
    );
    const posts: string[][] = [];
    const calls: string[] = [];
    const caller: PodscanCaller = {
      async get(path) {
        calls.push(`GET ${path}`);
        if (path === `/podcasts/${retry}/latest/sponsor`) throw timeoutErr();
        throw statusErr(404, "missing");
      },
      async post(_path, body) {
        calls.push("POST /podcasts/batch-probe");
        const ids = idsOf(body);
        posts.push(ids);
        if (ids.includes(retry)) throw timeoutErr();
        const results: Record<string, string | null> = {};
        for (const id of ids) results[id] = `ep_${id}`;
        return { results } as never;
      },
      rateLimit: () => ({ limit: 120, remaining: 100 }),
    };
    const result = await runImport(parseArgs(["--dry-run", "--no-enrich"]), deps(dir, caller));
    expect(result.exitCode).toBe(0);
    expect(posts.some((ids) => ids.includes(kept))).toBe(false);
    expect(posts.some((ids) => ids.includes(retry))).toBe(true);
    expect(posts.some((ids) => ids.length === 1 && ids[0] === fresh)).toBe(true);
    const saved = await readCheckpoint(file);
    expect(saved.probe?.kept_show).toBe("ep_kept");
    expect(saved.probe?.fresh_show).toBe("ep_fresh_show");
    expect(saved.probe?.retry_show).toBeUndefined();
    expect(saved.probeFailed).toEqual([retry]);
    const text = logs.join("\n");
    expect(text).toContain("Probe failed shows: 1");
    expect(callsUsed(text)).toBe(calls.length);
    expect(calls.some((call) => call.startsWith("GET /podcasts/search"))).toBe(false);
  });
});

async function expectSplit(kind: "timeout" | "503"): Promise<void> {
  const dir = await tempDir();
  const logs = spyLogs();
  const file = join(dir, "checkpoint.json");
  const ids = ["id_a", "id_b", "id_c", "id_d"];
  const posts: string[][] = [];
  const calls: string[] = [];
  const firstHalf: { probe: Record<string, string | null> | null } = { probe: null };
  const caller: PodscanCaller = {
    async get(path, params) {
      calls.push(`GET ${path}`);
      if (path === "/podcasts/search") {
        return searchBody(params?.has_sponsors === true ? [] : ids) as never;
      }
      throw statusErr(404, "missing");
    },
    async post(_path, body) {
      calls.push("POST /podcasts/batch-probe");
      const batch = idsOf(body);
      posts.push(batch);
      const halves = posts.filter((item) => item.length === 2);
      if (halves.length === 2 && firstHalf.probe == null) {
        const saved = JSON.parse(await readFile(file, "utf8")) as { probe?: Record<string, string | null> };
        firstHalf.probe = saved.probe ?? {};
      }
      if (batch.length === ids.length) {
        throw kind === "timeout" ? timeoutErr() : statusErr(503, "unavailable");
      }
      const results: Record<string, string | null> = {};
      for (const id of batch) results[id] = `ep_${id}`;
      return { results } as never;
    },
    rateLimit: () => ({ limit: 120, remaining: 100 }),
  };
  const result = await runImport(parseArgs(["--dry-run", "--sample", "25", "--no-enrich"]), deps(dir, caller));
  expect(result.exitCode).toBe(0);
  expect(firstHalf.probe?.id_a).toBe("ep_id_a");
  expect(firstHalf.probe?.id_b).toBe("ep_id_b");
  expect(firstHalf.probe?.id_c).toBeUndefined();
  expect(firstHalf.probe?.id_d).toBeUndefined();
  expect(posts.map((batch) => batch.length)).toEqual([4, 4, 4, 4, 4, 2, 2]);
  const saved = await readCheckpoint(file);
  expect(saved.probe).toEqual({
    id_a: "ep_id_a",
    id_b: "ep_id_b",
    id_c: "ep_id_c",
    id_d: "ep_id_d",
  });
  expect(saved.probeFailed).toEqual([]);
  const text = logs.join("\n");
  expect(text).toContain("Probe failed shows: 0");
  expect(callsUsed(text)).toBe(calls.length);
  expect(calls.filter((call) => call.startsWith("POST")).length).toBe(TRANSIENT_ATTEMPTS + 2);
}

async function runFallback(mode: "404" | "timeout"): Promise<{
  exitCode: number;
  probe?: Record<string, string | null>;
  probeFailed?: string[];
  text: string;
  calls: number;
  sponsorGets: number;
}> {
  const dir = await tempDir();
  const logs = spyLogs();
  const calls: string[] = [];
  const caller: PodscanCaller = {
    async get(path, params) {
      calls.push(`GET ${path}`);
      if (path === "/podcasts/search") {
        const ids = params?.has_sponsors === true ? [] : ["bad_show", "good_show"];
        return searchBody(ids) as never;
      }
      if (path === "/podcasts/bad_show/latest/sponsor") {
        if (mode === "404") throw statusErr(404, "missing");
        throw timeoutErr();
      }
      throw statusErr(404, "missing");
    },
    async post(_path, body) {
      calls.push("POST /podcasts/batch-probe");
      const ids = idsOf(body);
      if (ids.includes("bad_show")) throw timeoutErr();
      const results: Record<string, string | null> = {};
      for (const id of ids) results[id] = `ep_${id}`;
      return { results } as never;
    },
    rateLimit: () => ({ limit: 120, remaining: 100 }),
  };
  const result = await runImport(parseArgs(["--dry-run", "--sample", "25", "--no-enrich"]), deps(dir, caller));
  const saved = await readCheckpoint(join(dir, "checkpoint.json"));
  return {
    exitCode: result.exitCode,
    probe: saved.probe,
    probeFailed: saved.probeFailed,
    text: logs.join("\n"),
    calls: calls.length,
    sponsorGets: calls.filter((call) => call === "GET /podcasts/bad_show/latest/sponsor").length,
  };
}

async function runStop(
  fail: () => Error,
  argv: string[]
): Promise<{ exitCode: number; posts: string[][]; text: string; saved: Awaited<ReturnType<typeof readCheckpoint>> }> {
  const dir = await tempDir();
  const logs = spyLogs();
  const posts: string[][] = [];
  const caller: PodscanCaller = {
    async get(path, params) {
      if (path === "/podcasts/search") {
        return searchBody(params?.has_sponsors === true ? [] : ["id_a", "id_b"]) as never;
      }
      throw statusErr(404, "missing");
    },
    async post(_path, body) {
      const ids = idsOf(body);
      posts.push(ids);
      throw fail();
    },
    rateLimit: () => ({ limit: 120, remaining: 100 }),
  };
  const result = await runImport(parseArgs(argv), deps(dir, caller));
  const saved = await readCheckpoint(join(dir, "checkpoint.json"));
  return { exitCode: result.exitCode, posts, text: logs.join("\n"), saved };
}
