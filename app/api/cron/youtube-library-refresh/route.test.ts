import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runYoutubeLibraryRefresh = vi.fn();

vi.mock("@/lib/youtube-library/refresh", () => ({
  runYoutubeLibraryRefresh: (...args: unknown[]) => runYoutubeLibraryRefresh(...args),
}));

import { GET } from "./route";

function request(authorization?: string): Request {
  return new Request("http://localhost/api/cron/youtube-library-refresh", {
    headers: authorization ? { Authorization: authorization } : {},
  });
}

describe("GET /api/cron/youtube-library-refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    runYoutubeLibraryRefresh.mockResolvedValue({
      skipped: true,
      reason: "missing_table",
      units: 0,
      refreshed: 0,
      deleted: 0,
      nulled: 0,
      tagging: null,
    });
  });

  it("rejects a request without the bearer secret", async () => {
    const missingEnv = await GET(request("Bearer anything") as never);
    expect(missingEnv.status).toBe(401);
    expect(runYoutubeLibraryRefresh).not.toHaveBeenCalled();

    process.env.CRON_SECRET = "cron-secret";
    expect((await GET(request() as never)).status).toBe(401);
    expect((await GET(request("Bearer other") as never)).status).toBe(401);
    expect(runYoutubeLibraryRefresh).not.toHaveBeenCalled();
  });

  it("runs the refresh when the bearer matches", async () => {
    process.env.CRON_SECRET = "cron-secret";
    const res = await GET(request("Bearer cron-secret") as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ skipped: true, reason: "missing_table" });
    expect(runYoutubeLibraryRefresh).toHaveBeenCalledOnce();

    runYoutubeLibraryRefresh.mockResolvedValue({
      skipped: false,
      units: 1,
      refreshed: 1,
      deleted: 0,
      nulled: 0,
      stopped: "time",
      tagging: { channels: 0, calls: 0, stopped: "time" },
      elapsedMs: 200_000,
      chunks: 1,
    });
    const timed = await GET(request("Bearer cron-secret") as never);
    expect(timed.status).toBe(200);
    await expect(timed.json()).resolves.toMatchObject({ stopped: "time", elapsedMs: 200_000, chunks: 1 });

    const src = readFileSync(join(process.cwd(), "app/api/cron/youtube-library-refresh/route.ts"), "utf8");
    expect(src).toContain("Bearer ${secret}");
    expect(src).toContain("export const maxDuration = 300");
    expect(src).toContain("Do not raise it");
    expect(src).not.toContain("\u2014");
    expect(src).not.toContain("YOUTUBE_API_KEY");

    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    expect(vercel.regions).toEqual(["pdx1"]);
    expect(vercel.crons).toContainEqual({
      path: "/api/cron/youtube-library-refresh",
      schedule: "0 18 * * *",
    });
  });

  it("redacts key=TESTKEY from a thrown refresh error", async () => {
    process.env.CRON_SECRET = "cron-secret";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    runYoutubeLibraryRefresh.mockRejectedValue(new Error("refresh failed key=TESTKEY"));
    const res = await GET(request("Bearer cron-secret") as never);
    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("TESTKEY");
    expect(error.mock.calls.flat().join(" ")).toContain("key=[redacted]");
    expect(error.mock.calls.flat().join(" ")).not.toContain("TESTKEY");
    error.mockRestore();
  });
});
