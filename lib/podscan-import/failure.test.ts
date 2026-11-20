import { describe, expect, it } from "vitest";
import { formatFailure, scrubReason } from "./failure";

const EMAIL = "owner@sponsor.example";
const API_KEY = "podscan-test-key-should-not-leak";
const SERVICE_KEY = "service-role-test-key-should-not-leak";

describe("formatFailure", () => {
  it("names the step and strips emails, keys, and query strings", () => {
    const err = new TypeError(
      `Unexpected token < in JSON at position 0 ${EMAIL} ${API_KEY} ${SERVICE_KEY} https://podscan.fm/api/v1/categories?api_key=${API_KEY}`
    );
    const line = formatFailure("categories", err);
    expect(line).toContain("podscan-import failed step=categories name=TypeError reason=");
    expect(line).toContain("Unexpected token < in JSON at position 0");
    expect(line).not.toContain("@");
    expect(line).not.toContain(EMAIL);
    expect(line).not.toContain(API_KEY);
    expect(line).not.toContain(SERVICE_KEY);
    expect(line).not.toContain("http");
    expect(line).not.toContain("?");
    expect(line).not.toContain("podscan.fm");
  });

  it("keeps a numeric status and hides a response body", () => {
    const err = Object.assign(new Error(`Podscan API error: {"message":"${EMAIL}"}`), {
      name: "PodscanApiError",
      status: 503,
    });
    const line = formatFailure("search", err);
    expect(line).toContain("step=search name=PodscanApiError status=503");
    expect(line).toContain("reason=unexpected response");
    expect(line).not.toContain("@");
    expect(line).not.toContain("{");
    expect(scrubReason(err)).toBe("unexpected response");
  });
});
