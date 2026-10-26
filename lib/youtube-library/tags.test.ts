import { describe, expect, it, vi } from "vitest";
import {
  deterministicNicheTags,
  parseTagResponse,
  runNicheTagBatches,
  TAG_BATCH_SIZE,
  TAG_DAILY_CAP,
} from "./tags";

describe("deterministic niche tags", () => {
  it("maps topic labels and keywords onto the existing taxonomy", () => {
    expect(deterministicNicheTags({ topicCategories: ["Physical fitness"], keywords: [] })).toEqual([
      "Health & Wellness",
    ]);
    expect(deterministicNicheTags({ topicCategories: [], keywords: ["investing"] })).toEqual([
      "Business & Finance",
    ]);
    expect(deterministicNicheTags({ topicCategories: ["Skincare"], keywords: ["makeup tutorial"] })).toEqual([
      "Education",
      "Fashion & Beauty",
    ]);
    expect(deterministicNicheTags({ topicCategories: ["True crime"], keywords: ["comedy"] })).toEqual([
      "True Crime",
      "Comedy",
    ]);
    expect(deterministicNicheTags({ topicCategories: ["quantum basketweaving"], keywords: [] })).toEqual([]);
    expect(
      deterministicNicheTags({ topicCategories: ["mental health", "Mental Health"], keywords: ["fitness"] })
    ).toEqual(["Health & Wellness"]);
  });
});

describe("batch tagging cap", () => {
  it("sends 50 channels per call and stops at 400", async () => {
    expect(TAG_DAILY_CAP).toBe(400);
    expect(TAG_BATCH_SIZE).toBe(50);
    const rows = Array.from({ length: 430 }, (_, index) => ({
      channel_id: `c${index}`,
      title: `Channel ${index}`,
      description: "A fitness channel",
      topic_categories: ["Fitness"],
      keywords: [] as string[],
    }));
    let cursor = 0;
    const saved = new Map<string, string[]>();
    const sizes: number[] = [];
    const result = await runNicheTagBatches({
      load: async (limit) => rows.slice(cursor, cursor + limit),
      save: async (channelId, tags) => {
        saved.set(channelId, tags);
        cursor += 1;
      },
      complete: async (batch) => {
        sizes.push(batch.length);
        return JSON.stringify({
          channels: batch.map((row) => ({
            channel_id: row.channel_id,
            tags: ["Health & Wellness", "Not A Real Tag"],
          })),
        });
      },
      log: () => {},
    });

    expect(sizes).toEqual([50, 50, 50, 50, 50, 50, 50, 50]);
    expect(result).toMatchObject({ channels: 400, calls: 8, stopped: "cap" });
    expect(saved.size).toBe(400);
    expect(saved.get("c0")).toEqual(["Health & Wellness"]);
    expect(cursor).toBe(400);
  });

  it("drops tags outside the taxonomy and does not save a failed call", () => {
    const parsed = parseTagResponse(
      '```json\n{"channels":[{"channel_id":"c1","tags":["Science","Made Up"]}]}\n```',
      new Set(["c1"])
    );
    expect(parsed.get("c1")).toEqual(["Science"]);
  });

  it("stops the batch when the model call throws and leaves those rows unsaved", async () => {
    const save = vi.fn();
    const result = await runNicheTagBatches({
      cap: 400,
      load: async () => [
        {
          channel_id: "c1",
          title: "t",
          description: "d",
          topic_categories: [],
          keywords: [],
        },
      ],
      save,
      complete: async () => {
        throw new Error("key=super-secret-key boom");
      },
      log: () => {},
    });
    expect(result.stopped).toBe("llm_error");
    expect(result.channels).toBe(0);
    expect(save).not.toHaveBeenCalled();
  });
});
