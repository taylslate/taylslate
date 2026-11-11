import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GOOGLE_DERIVED_AIRCHECK_PROVIDERS,
  isGoogleDerivedAircheck,
} from "./google-data";
import { filterLearningAirchecks } from "./load";

describe("isGoogleDerivedAircheck", () => {
  it("matches youtube-captions exactly", () => {
    expect(GOOGLE_DERIVED_AIRCHECK_PROVIDERS).toEqual(["youtube-captions"]);
    expect(isGoogleDerivedAircheck({ provider: "youtube-captions" })).toBe(true);
  });

  it("is false for null, missing, and other providers", () => {
    expect(isGoogleDerivedAircheck({ provider: null })).toBe(false);
    expect(isGoogleDerivedAircheck({})).toBe(false);
    expect(isGoogleDerivedAircheck({ provider: undefined })).toBe(false);
    expect(isGoogleDerivedAircheck({ provider: "podscan" })).toBe(false);
    expect(isGoogleDerivedAircheck({ provider: "deepgram" })).toBe(false);
    expect(isGoogleDerivedAircheck({ provider: "whisper" })).toBe(false);
    expect(isGoogleDerivedAircheck({ provider: "YouTube-Captions" })).toBe(false);
  });
});

describe("filterLearningAirchecks", () => {
  it("drops youtube-captions and keeps null, podscan, and other providers", () => {
    const rows = [
      {
        io_line_item_id: "yt-evidence",
        provider: "youtube-captions",
        match_evidence: { code_or_url: "found" },
      },
      {
        io_line_item_id: "null-decision",
        provider: null,
        review_decision: "confirmed" as const,
      },
      {
        io_line_item_id: "podscan",
        provider: "podscan",
        review_decision: "rejected" as const,
      },
      {
        io_line_item_id: "missing-provider",
        review_decision: "confirmed" as const,
      },
      {
        io_line_item_id: "deepgram",
        provider: "deepgram",
        review_decision: "confirmed" as const,
      },
      {
        io_line_item_id: "whisper",
        provider: "whisper",
        review_decision: "confirmed" as const,
      },
      {
        io_line_item_id: "wrong-case",
        provider: "YouTube-Captions",
        review_decision: "confirmed" as const,
      },
    ];

    expect(filterLearningAirchecks(rows).map((row) => row.io_line_item_id)).toEqual([
      "null-decision",
      "podscan",
      "missing-provider",
      "deepgram",
      "whisper",
      "wrong-case",
    ]);
  });
});

describe("load.ts aircheck reads", () => {
  const src = readFileSync(join(process.cwd(), "lib/learning/load.ts"), "utf8");

  it("includes provider on both reads and filters both result sets", () => {
    expect(src).toContain('"io_line_item_id, provider, match_evidence"');
    expect(src).toContain('"io_line_item_id, provider, review_decision"');
    expect(src).not.toContain('"io_line_item_id, match_evidence"');
    expect(src).not.toContain('"io_line_item_id, review_decision"');
    expect(src.match(/filterLearningAirchecks\(/g)).toHaveLength(2);
  });
});
