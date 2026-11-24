import { describe, expect, it } from "vitest";
import { stripCampaignContactKeys } from "./campaign-contacts";

const nested = { keep: true, contactEmail: "nested@example.test" };

describe("stripCampaignContactKeys", () => {
  it("removes contactEmail from scored shows and leaves every other value", () => {
    const scored = [
      { podcastId: "a", contactEmail: "host@example.test", name: "Daily", nested },
      { podcastId: "b", name: "Bare" },
      "plain",
      4,
      null,
    ];
    const out = stripCampaignContactKeys({ scored_shows: scored });
    expect(out.scored_shows).toEqual([
      { podcastId: "a", name: "Daily", nested },
      { podcastId: "b", name: "Bare" },
      "plain",
      4,
      null,
    ]);
    expect(out.scored_shows?.[0]).not.toHaveProperty("contactEmail");
    expect((out.scored_shows?.[0] as { nested: unknown }).nested).toBe(nested);
    expect(scored[0]).toHaveProperty("contactEmail");
  });

  it("removes contact_email from each legacy array", () => {
    const row = { show_id: "rec-1", contact_email: "host@example.test", name: "Legacy", nested };
    const out = stripCampaignContactKeys({
      recommendations: [row, "x"],
      youtube_recommendations: [{ contact_email: "", title: "Video" }],
      expansion_opportunities: [{ contact_email: null, n: 1 }],
    });
    expect(out.recommendations).toEqual([
      { show_id: "rec-1", name: "Legacy", nested },
      "x",
    ]);
    expect(out.youtube_recommendations).toEqual([{ title: "Video" }]);
    expect(out.expansion_opportunities).toEqual([{ n: 1 }]);
    expect(row).toHaveProperty("contact_email");
  });

  it("passes non-arrays through and is idempotent", () => {
    const fields = {
      scored_shows: { contactEmail: "host@example.test" },
      recommendations: null,
      youtube_recommendations: "nope",
    };
    const once = stripCampaignContactKeys(fields);
    expect(once.scored_shows).toEqual({ contactEmail: "host@example.test" });
    expect(once.recommendations).toBeNull();
    expect(once.youtube_recommendations).toBe("nope");
    const twice = stripCampaignContactKeys(once);
    expect(twice).toEqual(once);
    const cleaned = stripCampaignContactKeys({
      scored_shows: [{ podcastId: "a", contactEmail: "host@example.test" }],
    });
    expect(stripCampaignContactKeys(cleaned)).toEqual(cleaned);
  });
});
