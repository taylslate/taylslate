import { describe, it, expect } from "vitest";
import { sanitizeReturnPath } from "./onboarding-return";

const ORIGIN = "https://www.taylslate.com";

describe("sanitizeReturnPath", () => {
  it("keeps a clean same-origin path (with query)", () => {
    expect(sanitizeReturnPath("/outreach/abc.def.ghi", ORIGIN)).toBe("/outreach/abc.def.ghi");
    expect(sanitizeReturnPath("/outreach/tok?x=1", ORIGIN)).toBe("/outreach/tok?x=1");
  });

  it("returns null for missing / blank input", () => {
    expect(sanitizeReturnPath(null, ORIGIN)).toBeNull();
    expect(sanitizeReturnPath(undefined, ORIGIN)).toBeNull();
    expect(sanitizeReturnPath("", ORIGIN)).toBeNull();
  });

  it("rejects protocol-relative and backslash-authority open redirects", () => {
    expect(sanitizeReturnPath("//evil.com", ORIGIN)).toBeNull();
    expect(sanitizeReturnPath("/\\evil.com", ORIGIN)).toBeNull();
  });

  it("rejects a non-path (no leading slash)", () => {
    expect(sanitizeReturnPath("@evil/x", ORIGIN)).toBeNull();
    expect(sanitizeReturnPath("evil.com", ORIGIN)).toBeNull();
  });

  it("rejects an absolute cross-origin URL", () => {
    expect(sanitizeReturnPath("https://evil.com/steal", ORIGIN)).toBeNull();
  });
});
