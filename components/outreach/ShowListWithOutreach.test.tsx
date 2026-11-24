/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ScoredShowRecord } from "@/lib/data/types";
import ShowListWithOutreach from "./ShowListWithOutreach";

const show = {
  podcastId: "33333333-3333-4333-8333-333333333333",
  name: "Daily",
  description: "",
  imageUrl: null,
  websiteUrl: null,
  rssUrl: null,
  categories: [],
  publisherName: null,
  language: null,
  episodeCount: 10,
  lastPostedAt: null,
  contactEmail: null,
  audienceSize: 12000,
  prsScore: null,
  compositeScore: 1,
  dimensionScores: { audienceFit: null, adEngagement: null, sponsorRetention: null, reach: 1 },
  estimatedCpm: 25,
  demographics: null,
  sponsorCount: 0,
  adEngagementRate: null,
} as unknown as ScoredShowRecord;

afterEach(cleanup);

describe("ShowListWithOutreach", () => {
  it("drops the email suffix and uses the server reach flag", () => {
    const { rerender } = render(
      <ShowListWithOutreach
        campaignId="c1"
        initialOutreaches={[]}
        selectedShows={[{ show, can_reach_out: false }]}
      />
    );
    expect(screen.getByText("Daily")).toBeTruthy();
    expect(document.body.textContent).not.toContain("host@example.test");
    expect(document.body.textContent).not.toContain("· host");
    const blocked = screen.getByRole("button", { name: "Reach out" }) as HTMLButtonElement;
    expect(blocked.disabled).toBe(true);
    expect(blocked.title).toBe("No contact on file yet");

    rerender(
      <ShowListWithOutreach
        campaignId="c1"
        initialOutreaches={[]}
        selectedShows={[{ show, can_reach_out: true }]}
      />
    );
    const open = screen.getByRole("button", { name: "Reach out" }) as HTMLButtonElement;
    expect(open.disabled).toBe(false);
    expect(open.title).toBe("Send outreach");
  });
});
