import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

interface Filter {
  column: string;
  value: unknown;
}

const db: { show_ownership_proofs: Row[] } = { show_ownership_proofs: [] };
let fail = "";

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
          resolve: (value: { data: Row[] | null; error: { message: string } | null }) => unknown,
          reject?: (err: unknown) => unknown
        ) {
          if (table !== "show_ownership_proofs") {
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          }
          if (fail) {
            return Promise.resolve({ data: null, error: { message: fail } }).then(resolve, reject);
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
  fail = "";
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
    fail = "permission denied";
    expect(await isPayoutOwnerVerified(SHOW, PROFILE)).toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });

  it("is not wired into payouts", () => {
    const self = readFileSync(join(process.cwd(), "lib/ownership/payout-gate.ts"), "utf8");
    const imports = self
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line) || /^\s*export\s+.*\bfrom\b/.test(line))
      .join("\n");
    expect(imports).not.toMatch(/payouts|stripe|billing|airchecks/);
    const payoutDir = join(process.cwd(), "lib/payouts");
    for (const name of readdirSync(payoutDir)) {
      if (!name.endsWith(".ts")) continue;
      const src = readFileSync(join(payoutDir, name), "utf8");
      expect(src, name).not.toMatch(/isPayoutOwnerVerified|ownership\/payout-gate|from ["']@\/lib\/ownership/);
    }
  });
});
