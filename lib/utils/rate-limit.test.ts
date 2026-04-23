import { describe, it, expect, beforeEach } from "vitest";
import { _resetRateLimits, checkRateLimit } from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => _resetRateLimits());

  it("allows requests up to the limit", () => {
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit("test-key", 5, 60_000);
      expect(result.ok).toBe(true);
    }
  });

  it("blocks the (limit + 1)th request and reports retry-after", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("k", 5, 60_000);
    const blocked = checkRateLimit("k", 5, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("scopes per key", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("a", 5, 60_000);
    expect(checkRateLimit("b", 5, 60_000).ok).toBe(true);
  });
});
