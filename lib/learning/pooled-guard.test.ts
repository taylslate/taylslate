import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FILES = [
  "lib/learning/pooled-deal-priors.ts",
  "lib/learning/pooled-priors.ts",
  "lib/learning/post-air-outcomes.ts",
  "supabase/migrations/069_pooled_deal_priors.sql",
];

const FORBIDDEN = ["airchecks", "youtube_aircheck_metrics"] as const;

describe("pooled jobs stay off airchecks", () => {
  it("does not read airchecks or youtube aircheck metrics", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      for (const word of FORBIDDEN) {
        expect(
          src.includes(word),
          `${rel} contains "${word}". Read docs/jobs/LRN-YT.md first.`
        ).toBe(false);
      }
    }
  });
});
