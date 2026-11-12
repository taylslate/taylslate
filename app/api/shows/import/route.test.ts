import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getUser, getUserProfile, importShows, isShowsAdmin } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserProfile: vi.fn(),
  importShows: vi.fn(),
  isShowsAdmin: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

vi.mock("@/lib/data/queries", () => ({
  getUserProfile,
  importShows,
}));

vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin,
}));

vi.mock("@/lib/security/rate-limit", () => ({
  enforceUpload: vi.fn(async () => null),
}));

import { enforceUpload } from "@/lib/security/rate-limit";
import { ROSTER_IMPORT_MAX_BYTES } from "@/lib/reps/roster-import";
import { POST } from "./route";

function call() {
  return POST(
    new NextRequest("http://x/api/shows/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shows: [{ name: "Night Desk", platform: "podcast" }],
      }),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  getUserProfile.mockResolvedValue({ role: "brand", email: "brand@taylslate.com" });
  isShowsAdmin.mockResolvedValue(false);
  importShows.mockResolvedValue({ imported: [], skipped: [], errors: [] });
});

describe("POST /api/shows/import", () => {
  it("returns 401 when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await call();
    expect(res.status).toBe(401);
    expect(importShows).not.toHaveBeenCalled();
  });

  it("returns 403 for a brand and allows an agent or an admin", async () => {
    const brand = await call();
    expect(brand.status).toBe(403);
    expect(importShows).not.toHaveBeenCalled();

    getUserProfile.mockResolvedValue({ role: "agent", email: "rep@taylslate.com" });
    const agent = await call();
    expect(agent.status).toBe(200);
    expect(importShows).toHaveBeenCalledTimes(1);

    getUserProfile.mockResolvedValue({ role: "brand", email: "ops@taylslate.com" });
    isShowsAdmin.mockResolvedValue(true);
    const admin = await call();
    expect(admin.status).toBe(200);
    expect(importShows).toHaveBeenCalledTimes(2);
  });

  it("returns imported as a count and lists a duplicate in skipped_names", async () => {
    getUserProfile.mockResolvedValue({ role: "agent", email: "rep@taylslate.com" });
    importShows.mockResolvedValue({
      imported: [{ id: "show-1", name: "Night Desk" }],
      skipped: ["The Daily Podcast"],
      errors: ["Broken: insert failed"],
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      imported: 1,
      skipped: 1,
      errors: 1,
      shows: [{ id: "show-1", name: "Night Desk" }],
      skipped_names: ["The Daily Podcast"],
      error_messages: ["Broken: insert failed"],
    });
  });

  it("rejects an oversized Content-Length before the body is read", async () => {
    getUserProfile.mockResolvedValue({ role: "agent", email: "rep@taylslate.com" });
    const script = scriptedBody(() => {
      throw new Error("body was read");
    });
    const res = await streamCall(script.body, {
      "content-type": "application/json",
      "content-length": String(ROSTER_IMPORT_MAX_BYTES + 1),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "This file is larger than 1 MB." });
    expect(script.reads()).toBe(0);
    expect(importShows).not.toHaveBeenCalled();
    expect(enforceUpload).toHaveBeenCalled();
  });

  it("returns 401 before checking size when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const script = scriptedBody(() => {
      throw new Error("body was read");
    });
    const res = await streamCall(script.body, {
      "content-type": "application/json",
      "content-length": String(ROSTER_IMPORT_MAX_BYTES + 1),
    });
    expect(res.status).toBe(401);
    expect(script.reads()).toBe(0);
    expect(enforceUpload).not.toHaveBeenCalled();
  });

  it("stops a body once it passes 1 MB", async () => {
    getUserProfile.mockResolvedValue({ role: "agent", email: "rep@taylslate.com" });
    const script = scriptedBody((readNumber) => {
      if (readNumber === 1) return new Uint8Array(ROSTER_IMPORT_MAX_BYTES);
      if (readNumber === 2) return new Uint8Array(1);
      throw new Error("body read continued past the cap");
    });
    const res = await streamCall(script.body, {
      "content-type": "application/json",
      "content-length": "10",
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "This file is larger than 1 MB." });
    expect(script.reads()).toBe(2);
    expect(importShows).not.toHaveBeenCalled();
  });

  it("rejects more than 500 shows", async () => {
    getUserProfile.mockResolvedValue({ role: "agent", email: "rep@taylslate.com" });
    const shows = Array.from({ length: 501 }, (_, index) => ({
      name: `Show ${index}`,
      platform: "podcast",
    }));
    const res = await POST(
      new NextRequest("http://x/api/shows/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shows }),
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Send at most 500 shows." });
    expect(importShows).not.toHaveBeenCalled();
  });

  it("imports a csv file that stays under the caps", async () => {
    getUserProfile.mockResolvedValue({ role: "agent", email: "rep@taylslate.com" });
    const form = new FormData();
    form.set(
      "file",
      new File(["Show Name,Platform\nNight Desk,podcast\n"], "shows.csv", { type: "text/csv" })
    );
    const res = await POST(
      new NextRequest("http://x/api/shows/import", { method: "POST", body: form })
    );
    expect(res.status).toBe(200);
    expect(importShows).toHaveBeenCalledWith([
      expect.objectContaining({ name: "Night Desk", platform: "podcast" }),
    ]);
  });
});

function scriptedBody(onRead: (readNumber: number) => Uint8Array | null) {
  let reads = 0;
  const body = {
    getReader() {
      return {
        async read() {
          reads += 1;
          const value = onRead(reads);
          if (!value) return { done: true as const, value: undefined };
          return { done: false as const, value };
        },
        async cancel() {},
      };
    },
  };
  return {
    body: body as unknown as ReadableStream<Uint8Array>,
    reads: () => reads,
  };
}

function streamCall(body: ReadableStream<Uint8Array>, headers: Record<string, string>) {
  return POST({
    url: "http://x/api/shows/import",
    headers: new Headers(headers),
    body,
  } as NextRequest);
}
