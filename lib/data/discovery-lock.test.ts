import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock supabaseAdmin's query builder. `from()` returns a builder whose
// insert() resolves to a queued {error} and whose delete() returns a chain that
// is both chainable (.eq/.lt) and awaitable (thenable → {error,count}).
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: { from } }));

import {
  claimDiscovery,
  releaseDiscovery,
  DISCOVERY_LOCK_TTL_MS,
} from "./discovery-lock";

function setupLock(opts: {
  inserts?: Array<{ error: { code?: string; message?: string } | null }>;
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

  const builder = {
    insert: vi.fn(() => Promise.resolve(inserts[i++] ?? { error: null })),
    delete: vi.fn(() => deleteChain),
  };
  from.mockReturnValue(builder);
  return { builder, deleteChain };
}

beforeEach(() => {
  from.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("claimDiscovery", () => {
  it("acquires a free slot on a clean insert", async () => {
    const { builder } = setupLock({ inserts: [{ error: null }] });
    expect(await claimDiscovery("c1")).toBe("acquired");
    expect(builder.insert).toHaveBeenCalledTimes(1);
    expect(builder.delete).not.toHaveBeenCalled();
  });

  it("returns exists when a fresh lock is held (nothing stale to steal)", async () => {
    const { builder, deleteChain } = setupLock({
      inserts: [{ error: { code: "23505" } }],
      deleteResult: { error: null, count: 0 },
    });

    expect(await claimDiscovery("c1")).toBe("exists");

    // It attempted a TTL-bounded steal but the live lock is newer than cutoff.
    expect(builder.delete).toHaveBeenCalledWith({ count: "exact" });
    expect(deleteChain.eq).toHaveBeenCalledWith("campaign_id", "c1");
    expect(deleteChain.lt).toHaveBeenCalledWith("created_at", expect.any(String));
    expect(builder.insert).toHaveBeenCalledTimes(1); // no reclaim attempted
  });

  it("steals an expired crash-orphan and reclaims (TTL expiry → retry claims)", async () => {
    const { builder, deleteChain } = setupLock({
      inserts: [{ error: { code: "23505" } }, { error: null }],
      deleteResult: { error: null, count: 1 }, // one stale row removed
    });

    expect(await claimDiscovery("c1")).toBe("acquired");

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
      inserts: [{ error: { code: "23505" } }, { error: { code: "23505" } }],
      deleteResult: { error: null, count: 1 },
    });
    expect(await claimDiscovery("c1")).toBe("exists");
  });

  it("fails open on a non-unique insert error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setupLock({ inserts: [{ error: { code: "08006", message: "conn" } }] });
    expect(await claimDiscovery("c1")).toBe("acquired");
  });

  it("returns exists when the stale-lock delete itself errors", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setupLock({
      inserts: [{ error: { code: "23505" } }],
      deleteResult: { error: { message: "delete failed" }, count: 0 },
    });
    expect(await claimDiscovery("c1")).toBe("exists");
  });

  it("fails open when the lock table throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    from.mockImplementation(() => {
      throw new Error("table unreachable");
    });
    expect(await claimDiscovery("c1")).toBe("acquired");
  });
});

describe("releaseDiscovery", () => {
  it("deletes the lock row by campaign_id", async () => {
    const { builder, deleteChain } = setupLock({ deleteResult: { error: null } });
    await releaseDiscovery("c1");
    expect(builder.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith("campaign_id", "c1");
  });

  it("swallows a delete error (fail-soft)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setupLock({ deleteResult: { error: { message: "boom" } } });
    await expect(releaseDiscovery("c1")).resolves.toBeUndefined();
  });
});
