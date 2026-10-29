import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runYoutubeLibraryPull = vi.fn();

vi.mock("@/lib/youtube-library/pull", () => ({
  runYoutubeLibraryPull: (...args: unknown[]) => runYoutubeLibraryPull(...args),
}));

import { GET } from "./route";

function request(authorization?: string): Request {
  return new Request("http://localhost/api/cron/youtube-library-pull", {
    headers: authorization ? { Authorization: authorization } : {},
  });
}

describe("GET /api/cron/youtube-library-pull", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    runYoutubeLibraryPull.mockResolvedValue({ skipped: true, reason: "missing_table", units: 0, upserted: 0 });
  });

  it("rejects a request without the bearer secret", async () => {
    const missingEnv = await GET(request("Bearer anything") as never);
    expect(missingEnv.status).toBe(401);
    expect(runYoutubeLibraryPull).not.toHaveBeenCalled();

    process.env.CRON_SECRET = "cron-secret";
    const missingHeader = await GET(request() as never);
    expect(missingHeader.status).toBe(401);
    const wrong = await GET(request("Bearer other") as never);
    expect(wrong.status).toBe(401);
    expect(runYoutubeLibraryPull).not.toHaveBeenCalled();
  });

  it("runs the pull when the bearer matches and does not log a key", async () => {
    process.env.CRON_SECRET = "cron-secret";
    const res = await GET(request("Bearer cron-secret") as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ skipped: true, reason: "missing_table" });
    expect(runYoutubeLibraryPull).toHaveBeenCalledOnce();

    const src = readFileSync(join(process.cwd(), "app/api/cron/youtube-library-pull/route.ts"), "utf8");
    expect(src).toContain("Bearer ${secret}");
    expect(src).not.toContain("YOUTUBE_API_KEY");
    expect(src).not.toMatch(/console\.(log|error|warn)\([^)]*apiKey/i);

    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    expect(vercel.regions).toEqual(["pdx1"]);
    expect(vercel.crons).toContainEqual({ path: "/api/cron/youtube-library-pull", schedule: "0 17 * * *" });
    expect(src).toContain("export const maxDuration = 300");
  });

  it("returns 200 when the pull stops for time and 200 when nothing is pending", async () => {
    process.env.CRON_SECRET = "cron-secret";
    runYoutubeLibraryPull.mockResolvedValue({
      skipped: false,
      seeded: 0,
      units: 101,
      upserted: 1,
      done: 0,
      pending: 1,
      stopped: "time",
      elapsedMs: 240000,
      searched: 1,
      chunks: 1,
    });
    const timed = await GET(request("Bearer cron-secret") as never);
    expect(timed.status).toBe(200);
    await expect(timed.json()).resolves.toMatchObject({ stopped: "time", elapsedMs: 240000 });

    runYoutubeLibraryPull.mockResolvedValue({
      skipped: false,
      seeded: 0,
      units: 0,
      upserted: 0,
      done: 0,
      pending: 0,
      stopped: null,
      elapsedMs: 4,
      searched: 0,
      chunks: 0,
    });
    const idle = await GET(request("Bearer cron-secret") as never);
    expect(idle.status).toBe(200);
    await expect(idle.json()).resolves.toMatchObject({ done: 0, stopped: null });
  });
});
