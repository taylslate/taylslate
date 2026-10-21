import { describe, it, expect } from "vitest";
import type { Show } from "@/lib/data/types";
import {
  cpmRangeFromRateCard,
  describeShowMedium,
  impliedYouTubeCpmRange,
  mediumPriorsForShow,
  podcastSurfaceFromShow,
  youtubeSurfaceFromShow,
} from "./show-surfaces";

function show(over: Partial<Show> = {}): Show {
  return {
    id: "s1",
    name: "Show",
    platform: "podcast",
    audience_size: 40_000,
    rate_card: { preroll_cpm: 15, midroll_cpm: 22, postroll_cpm: 10 },
    price_type: "cpm",
    rss_url: "https://feeds.example/show",
    ...over,
  } as Show;
}

describe("show surfaces", () => {
  it("reads a podcast CPM range off the placement rates", () => {
    expect(cpmRangeFromRateCard({ midroll_cpm: 22, postroll_cpm: 10 })).toEqual({
      min: 10,
      max: 22,
    });
    expect(cpmRangeFromRateCard({ flat_rate: 5000 })).toBeUndefined();
  });

  it("puts audience, CPM range, and the RSS link on a podcast surface", () => {
    const surface = podcastSurfaceFromShow(show());
    expect(surface.audience_size).toBe(40_000);
    expect(surface.cpm_range).toEqual({ min: 10, max: 22 });
    expect(surface.links?.rss).toBe("https://feeds.example/show");
    expect(surface.rss_url).toBe("https://feeds.example/show");
  });

  it("puts audience, an implied CPM band, and the channel link on a YouTube surface", () => {
    const surface = youtubeSurfaceFromShow(
      show({
        platform: "youtube",
        price_type: "flat_rate",
        audience_size: 100_000,
        rate_card: { flat_rate: 5000 },
        youtube_channel_id: "UCabc",
        rss_url: undefined,
      })
    );
    expect(surface.audience_size).toBe(100_000);
    expect(surface.youtube_channel_id).toBe("UCabc");
    expect(surface.links?.channel).toBe("https://www.youtube.com/channel/UCabc");
    // $5,000 / (100k/1000) = $50 implied. Card band is half to double.
    expect(surface.cpm_range).toEqual({ min: 25, max: 100 });
    expect(impliedYouTubeCpmRange(5000, 0)).toBeUndefined();
  });

  it("records a prior with weight 1 and does not invent the other medium", () => {
    const priors = mediumPriorsForShow(show());
    expect(priors.podcast).toEqual({
      cpm_min: 10,
      cpm_max: 22,
      engagement_weight: 1,
      frequency_spots: 3,
    });
    expect(priors.youtube).toBeUndefined();
  });

  it("names the medium, and both when the show is a simulcast", () => {
    expect(describeShowMedium(show())).toBe("podcast");
    expect(describeShowMedium(show({ platform: "youtube" }))).toBe("YouTube");
    expect(
      describeShowMedium(
        show({
          surfaces: { podcast: { audience_size: 1 }, youtube: { audience_size: 2 } },
        })
      )
    ).toBe("podcast and YouTube");
  });
});
