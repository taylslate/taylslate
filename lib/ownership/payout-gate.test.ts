import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

interface Filter {
  column: string;
  value: unknown;
}

const db: { show_ownership_proofs: Row[] } = { show_ownership_proofs: [] };
let fail: { code?: string; message: string } | null = null;
let explode = false;

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => row[filter.column] === filter.value);
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from(table: string) {
      const filters: Filter[] = [];
      const api = {
        select() {
          return api;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return api;
        },
        limit() {
          return api;
        },
        then(
          resolve: (value: { data: Row[] | null; error: { code?: string; message: string } | null }) => unknown,
          reject?: (err: unknown) => unknown
        ) {
          if (table !== "show_ownership_proofs") {
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          }
          if (explode) {
            return Promise.reject(new Error("secret-db-text")).then(resolve, reject);
          }
          if (fail) {
            return Promise.resolve({ data: null, error: fail }).then(resolve, reject);
          }
          const hits = db.show_ownership_proofs.filter((row) => matches(row, filters));
          return Promise.resolve({ data: hits, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  },
}));

import { isPayoutOwnerVerified } from "./payout-gate";

const SHOW = "11111111-1111-4111-8111-111111111111";
const PROFILE = "33333333-3333-4333-8333-333333333333";
const OTHER_PROFILE = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  db.show_ownership_proofs = [];
  fail = null;
  explode = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("isPayoutOwnerVerified", () => {
  it("is true only when a verified proof ties that show to that profile", async () => {
    db.show_ownership_proofs.push({
      id: "proof-1",
      show_id: SHOW,
      show_profile_id: PROFILE,
      status: "verified",
    });
    expect(await isPayoutOwnerVerified(SHOW, PROFILE)).toBe(true);
    expect(await isPayoutOwnerVerified(SHOW, OTHER_PROFILE)).toBe(false);
    expect(await isPayoutOwnerVerified("other-show", PROFILE)).toBe(false);
  });

  it("is false for pending, rejected, contested, and expired proofs", async () => {
    for (const status of ["pending", "rejected", "contested", "expired"]) {
      db.show_ownership_proofs = [
        { id: "proof-1", show_id: SHOW, show_profile_id: PROFILE, status },
      ];
      expect(await isPayoutOwnerVerified(SHOW, PROFILE)).toBe(false);
    }
  });

  it("is false when an id is missing or the read fails", async () => {
    db.show_ownership_proofs.push({
      id: "proof-1",
      show_id: SHOW,
      show_profile_id: PROFILE,
      status: "verified",
    });
    expect(await isPayoutOwnerVerified("", PROFILE)).toBe(false);
    expect(await isPayoutOwnerVerified(SHOW, "")).toBe(false);
    fail = { code: "42501", message: "secret-db-text" };
    expect(await isPayoutOwnerVerified(SHOW, PROFILE)).toBe(false);
    expect(console.warn).toHaveBeenCalledWith("[isPayoutOwnerVerified]", "42501");
    const logged = vi.mocked(console.warn).mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(logged).not.toContain("secret-db-text");
  });

  it("logs a code when the proof read throws", async () => {
    explode = true;
    expect(await isPayoutOwnerVerified(SHOW, PROFILE)).toBe(false);
    expect(console.warn).toHaveBeenCalledWith("[isPayoutOwnerVerified]", "threw");
    const logged = vi.mocked(console.warn).mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(logged).not.toContain("secret-db-text");
  });

  it("names the payout callers and does not import them", () => {
    const self = readFileSync(join(process.cwd(), "lib/ownership/payout-gate.ts"), "utf8");
    expect(self).toContain("transferPayoutForPayment");
    expect(self).toContain("transferEarlyPayoutForPayment");
    expect(self).not.toContain("Not wired");
    const imports = self
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line) || /^\s*export\s+.*\bfrom\b/.test(line))
      .join("\n");
    expect(imports).not.toMatch(/payouts|stripe|billing|airchecks/);
    const transfer = readFileSync(join(process.cwd(), "lib/payouts/transfer.ts"), "utf8");
    expect(transfer).toContain("isPayoutOwnerVerified");
  });
});
