import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runAutomatedAirchecks = vi.fn();
const runYoutubeCaptionAirchecks = vi.fn();

vi.mock("@/lib/airchecks/run", () => ({
  runAutomatedAirchecks: (...args: unknown[]) => runAutomatedAirchecks(...args),
}));

vi.mock("@/lib/youtube-oauth/feed", () => ({
  runYoutubeCaptionAirchecks: (...args: unknown[]) => runYoutubeCaptionAirchecks(...args),
}));

import { GET } from "./route";

function request(authorization?: string): Request {
  return new Request("http://localhost/api/cron/airchecks", {
    headers: authorization ? { Authorization: authorization } : {},
  });
}

describe("GET /api/cron/airchecks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    runAutomatedAirchecks.mockResolvedValue({ skipped: "missing_openai_api_key" });
    runYoutubeCaptionAirchecks.mockResolvedValue({
      skipped: "not_configured",
      stopped: null,
      considered: 0,
      captioned: 0,
      ready: 0,
      failed: 0,
      analytics: 0,
    });
  });

  it("rejects a request without CRON_SECRET", async () => {
    const missingEnv = await GET(request("Bearer anything") as never);
    expect(missingEnv.status).toBe(401);
    process.env.CRON_SECRET = "cron-secret";
    const missingHeader = await GET(request() as never);
    expect(missingHeader.status).toBe(401);
    const wrong = await GET(request("Bearer other") as never);
    expect(wrong.status).toBe(401);
    const sameLength = await GET(request("Bearer cron-secreX") as never);
    expect(sameLength.status).toBe(401);
    expect(runAutomatedAirchecks).not.toHaveBeenCalled();
    expect(runYoutubeCaptionAirchecks).not.toHaveBeenCalled();
  });

  it("runs the aircheck job and is on the cron list", async () => {
    process.env.CRON_SECRET = "cron-secret";
    const res = await GET(request("Bearer cron-secret") as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      skipped: "missing_openai_api_key",
      youtube: {
        skipped: "not_configured",
        stopped: null,
        considered: 0,
        captioned: 0,
        ready: 0,
        failed: 0,
        analytics: 0,
      },
    });
    expect(runAutomatedAirchecks).toHaveBeenCalledOnce();
    expect(runYoutubeCaptionAirchecks).toHaveBeenCalledOnce();

    const src = readFileSync(join(process.cwd(), "app/api/cron/airchecks/route.ts"), "utf8");
    expect(src).not.toMatch(/lib\/(stripe|payouts|billing)/);
    expect(src).not.toContain("\u2014");

    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    expect(vercel.regions).toEqual(["pdx1"]);
    expect(vercel.crons).toContainEqual({ path: "/api/cron/airchecks", schedule: "0 20 * * *" });
  });

  it("keeps the transcription run when the YouTube step throws", async () => {
    process.env.CRON_SECRET = "cron-secret";
    runYoutubeCaptionAirchecks.mockRejectedValueOnce(new Error("youtube blew up"));
    const res = await GET(request("Bearer cron-secret") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.youtube).toEqual({ error: "unavailable" });
    expect(body.skipped).toBe("missing_openai_api_key");
    expect(runAutomatedAirchecks).toHaveBeenCalledOnce();
    expect(JSON.stringify(body)).not.toContain("blew up");
  });
});
