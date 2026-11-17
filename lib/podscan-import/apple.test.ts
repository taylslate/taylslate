import { describe, expect, it } from "vitest";
import { lookupAppleFeeds } from "./apple";
import { HostLimiter } from "./rate-limit";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("apple lookup", () => {
  it("batches ids and ignores a non-numeric id", async () => {
    const urls: string[] = [];
    const limiter = new HostLimiter(1000, 4, () => Date.now(), async () => {});
    const found = await lookupAppleFeeds(["11", "22", "nope", "11"], {
      limiter,
      sleepFn: async () => {},
      rng: () => 0,
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        const id = new URL(url).searchParams.get("id") ?? "";
        const ids = id.split(",");
        return json({
          resultCount: ids.length,
          results: ids.map((one) => ({ collectionId: Number(one), feedUrl: `https://feeds.example.test/${one}.xml` })),
        });
      },
    });
    expect(found.batched).toBe(true);
    expect(found.feeds.get("11")).toBe("https://feeds.example.test/11.xml");
    expect(found.feeds.get("22")).toBe("https://feeds.example.test/22.xml");
    expect(found.feeds.has("nope")).toBe(false);
    expect(urls.some((url) => url.includes("term="))).toBe(false);
    expect(urls[0]).toContain("id=11,22");
  });

  it("falls back to one id per call when the batch misses a feed", async () => {
    const urls: string[] = [];
    const limiter = new HostLimiter(1000, 4, () => Date.now(), async () => {});
    const found = await lookupAppleFeeds(["11", "22", "33"], {
      limiter,
      sleepFn: async () => {},
      rng: () => 0,
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        const ids = (new URL(url).searchParams.get("id") ?? "").split(",");
        if (ids.length > 1) {
          return json({
            resultCount: 1,
            results: [{ collectionId: 11, feedUrl: "https://feeds.example.test/11.xml" }],
          });
        }
        return json({
          resultCount: 1,
          results: [{ collectionId: Number(ids[0]), feedUrl: `https://feeds.example.test/${ids[0]}.xml` }],
        });
      },
    });
    expect(found.batched).toBe(false);
    expect(found.feeds.get("22")).toBe("https://feeds.example.test/22.xml");
    expect(found.feeds.get("33")).toBe("https://feeds.example.test/33.xml");
    expect(urls.filter((url) => url.includes(","))).toHaveLength(1);
  });
});
