import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock supabaseAdmin's query builder. `from()` returns a builder whose
// insert() chains .select().single() (resolving to a queued {data,error} — the
// inserted row carries created_at, the fence token), and whose delete() returns
// a chain that is both chainable (.eq/.lt) and awaitable (thenable →
// {error,count}).
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { from } }));

import {
  claimDiscovery,
  releaseDiscovery,
  DISCOVERY_LOCK_TTL_MS,
} from "./discovery-lock";

type InsertResult = {
  data?: { created_at: string } | null;
  error: { code?: string; message?: string } | null;
};

function setupLock(opts: {
  inserts?: InsertResult[];
  deleteResult?: { error: { message?: string } | null; count?: number };
}) {
  let i = 0;
  const inserts = opts.inserts ?? [];
  const deleteResult = opts.deleteResult ?? { error: null, count: 0 };

  const deleteChain: Record<string, ReturnType<typeof vi.fn> | unknown> = {};
  deleteChain.eq = vi.fn(() => deleteChain);
  deleteChain.lt = vi.fn(() => deleteChain);
  (deleteChain as { then: unknown }).then = (
    onF: (v: unknown) => unknown,
    onR?: (e: unknown) => unknown
  ) => Promise.resolve(deleteResult).then(onF, onR);

  const single = vi.fn(() =>
    Promise.resolve(inserts[i++] ?? { data: { created_at: "T-default" }, error: null })
  );
  const builder = {
    insert: vi.fn(() => ({ select: vi.fn(() => ({ single })) })),
    delete: vi.fn(() => deleteChain),
  };
  from.mockReturnValue(builder);
  return { builder, deleteChain, single };
}

const OK = (createdAt: string): InsertResult => ({
  data: { created_at: createdAt },
  error: null,
});
const DUP: InsertResult = { data: null, error: { code: "23505" } };

beforeEach(() => {
  from.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("claimDiscovery", () => {
  it("acquires a free slot and returns the created_at fence token", async () => {
    const { builder } = setupLock({ inserts: [OK("2026-06-24T00:00:00Z")] });
    const res = await claimDiscovery("c1");
    expect(res).toEqual({ status: "acquired", token: "2026-06-24T00:00:00Z" });
    expect(builder.insert).toHaveBeenCalledTimes(1);
    expect(builder.delete).not.toHaveBeenCalled();
  });

  it("returns exists when a fresh lock is held (nothing stale to steal)", async () => {
    const { builder, deleteChain } = setupLock({
      inserts: [DUP],
      deleteResult: { error: null, count: 0 },
    });

    expect(await claimDiscovery("c1")).toEqual({ status: "exists" });

    // It attempted a TTL-bounded steal but the live lock is newer than cutoff.
    expect(builder.delete).toHaveBeenCalledWith({ count: "exact" });
    expect(deleteChain.eq).toHaveBeenCalledWith("campaign_id", "c1");
    expect(deleteChain.lt).toHaveBeenCalledWith("created_at", expect.any(String));
    expect(builder.insert).toHaveBeenCalledTimes(1); // no reclaim attempted
  });

  it("steals an expired crash-orphan and reclaims with a fresh token", async () => {
    const { builder, deleteChain } = setupLock({
      inserts: [DUP, OK("2026-06-24T00:05:00Z")],
      deleteResult: { error: null, count: 1 }, // one stale row removed
    });

    const res = await claimDiscovery("c1");
    expect(res).toEqual({ status: "acquired", token: "2026-06-24T00:05:00Z" });

    expect(builder.insert).toHaveBeenCalledTimes(2); // initial + reclaim
    expect(builder.delete).toHaveBeenCalledWith({ count: "exact" });
    // Cutoff is roughly DISCOVERY_LOCK_TTL_MS in the past.
    const cutoff = Date.parse(
      (deleteChain.lt as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
    );
    expect(Number.isNaN(cutoff)).toBe(false);
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(
      DISCOVERY_LOCK_TTL_MS - 5_000
    );
  });

  it("returns exists if another racer wins the reclaim after the steal", async () => {
    setupLock({
      inserts: [DUP, DUP],
      deleteResult: { error: null, count: 1 },
    });
    expect(await claimDiscovery("c1")).toEqual({ status: "exists" });
  });

  it("fails open (null token) on a non-unique insert error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setupLock({
      inserts: [{ data: null, error: { code: "08006", message: "conn" } }],
    });
    expect(await claimDiscovery("c1")).toEqual({ status: "acquired", token: null });
  });

  it("returns exists when the stale-lock delete itself errors", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setupLock({
      inserts: [DUP],
      deleteResult: { error: { message: "delete failed" }, count: 0 },
    });
    expect(await claimDiscovery("c1")).toEqual({ status: "exists" });
  });

  it("fails open (null token) when the lock table throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    from.mockImplementation(() => {
      throw new Error("table unreachable");
    });
    expect(await claimDiscovery("c1")).toEqual({ status: "acquired", token: null });
  });
});

describe("releaseDiscovery", () => {
  it("fences the delete by campaign_id AND the claim's created_at token", async () => {
    const { builder, deleteChain } = setupLock({ deleteResult: { error: null } });
    await releaseDiscovery("c1", "2026-06-24T00:00:00Z");
    expect(builder.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith("campaign_id", "c1");
    // The fence: only OUR row (this created_at) is deleted, so a TTL-stolen
    // successor's newer-created_at lock is never clobbered.
    expect(deleteChain.eq).toHaveBeenCalledWith(
      "created_at",
      "2026-06-24T00:00:00Z"
    );
  });

  it("falls back to delete-by-campaign_id when the token is null (fail-open)", async () => {
    const { deleteChain } = setupLock({ deleteResult: { error: null } });
    await releaseDiscovery("c1", null);
    expect(deleteChain.eq).toHaveBeenCalledWith("campaign_id", "c1");
    expect(deleteChain.eq).not.toHaveBeenCalledWith(
      "created_at",
      expect.anything()
    );
  });

  it("swallows a delete error (fail-soft)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setupLock({ deleteResult: { error: { message: "boom" } } });
    await expect(
      releaseDiscovery("c1", "2026-06-24T00:00:00Z")
    ).resolves.toBeUndefined();
  });
});
