import { describe, it, expect } from "vitest";
import { ownershipStatusFromRow, transformShow } from "./show-transform";

describe("transformShow surfaces and medium_priors", () => {
  it("maps both JSONB columns and turns null into undefined", () => {
    const surfaces = {
      podcast: {
        audience_size: 40000,
        cpm_range: { min: 15, max: 22 },
        links: { rss: "https://feeds.example/show" },
      },
      youtube: {
        audience_size: 90000,
        links: { channel: "https://www.youtube.com/channel/UCabc" },
        youtube_channel_id: "UCabc",
      },
    };
    const medium_priors = {
      podcast: { cpm_min: 15, cpm_max: 22, engagement_weight: 1, frequency_spots: 3 },
      youtube: { engagement_weight: 1, frequency_spots: 3 },
    };

    const show = transformShow({
      id: "show-1",
      name: "Recovery Lab",
      platform: "podcast",
      surfaces,
      medium_priors,
    });

    expect(show.surfaces).toEqual(surfaces);
    expect(show.medium_priors).toEqual(medium_priors);

    const empty = transformShow({
      id: "show-2",
      name: "Solo",
      platform: "podcast",
      surfaces: null,
      medium_priors: null,
    });
    expect(empty.surfaces).toBeUndefined();
    expect(empty.medium_priors).toBeUndefined();
  });

  it("does not copy ownership_status onto the domain show", () => {
    const show = transformShow({
      id: "show-1",
      name: "Recovery Lab",
      platform: "podcast",
      ownership_status: "verified",
      contact_email: "host@show.test",
    });
    expect(show).not.toHaveProperty("ownership_status");
    expect(show.contact.email).toBe("host@show.test");
    expect(ownershipStatusFromRow("verified")).toBe("verified");
    expect(ownershipStatusFromRow("pending")).toBeUndefined();
  });
});
