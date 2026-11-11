import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({
  lengths: [] as number[],
}));

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return {
    ...actual,
    timingSafeEqual: (left: NodeJS.ArrayBufferView, right: NodeJS.ArrayBufferView) => {
      seen.lengths.push(left.byteLength);
      return actual.timingSafeEqual(left, right);
    },
  };
});

import { isCronAuthorized } from "@/lib/security/cron-auth";

const SECRET = "cron-secret";

function request(authorization?: string): Request {
  return new Request("http://localhost/api/cron/example", {
    headers: authorization ? { authorization } : {},
  });
}

describe("isCronAuthorized", () => {
  beforeEach(() => {
    seen.lengths.length = 0;
    vi.stubEnv("CRON_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts the right token and rejects a same-length wrong token", () => {
    expect(isCronAuthorized(request(`Bearer ${SECRET}`))).toBe(true);
    expect(seen.lengths).toEqual([`Bearer ${SECRET}`.length]);

    seen.lengths.length = 0;
    expect(isCronAuthorized(request("Bearer cron-secreX"))).toBe(false);
    expect(seen.lengths).toEqual(["Bearer cron-secreX".length]);
  });

  it("rejects a missing header and a different length without timingSafeEqual", () => {
    expect(isCronAuthorized(request())).toBe(false);
    expect(isCronAuthorized(request("Bearer other"))).toBe(false);
    expect(seen.lengths).toEqual([]);
  });

  it("rejects an unset secret unless local dev is explicitly allowed", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(isCronAuthorized(request(`Bearer ${SECRET}`))).toBe(false);
    expect(isCronAuthorized(request())).toBe(false);

    vi.stubEnv("NODE_ENV", "production");
    expect(isCronAuthorized(request(), { allowUnsetSecretOutsideProduction: true })).toBe(false);

    vi.stubEnv("NODE_ENV", "development");
    expect(isCronAuthorized(request())).toBe(false);
    expect(isCronAuthorized(request(), { allowUnsetSecretOutsideProduction: true })).toBe(true);
    expect(seen.lengths).toEqual([]);
  });
});
