// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { buildLearningReview } from "@/lib/learning/review";
import { LearningReviewView } from "./learning-review-view";

afterEach(() => {
  cleanup();
});

describe("LearningReviewView", () => {
  it("shows the holding line before a flight completes", () => {
    const review = buildLearningReview({
      campaignStatus: "active",
      deals: [],
      rings: [],
      scaleShows: [],
      overrides: [],
      showNames: {},
    });
    render(
      <LearningReviewView campaignId="camp-1" campaignName="Sauna test" review={review} />
    );
    expect(screen.getByTestId("learning-holding")).toHaveTextContent(
      "This review opens after a flight completes."
    );
    expect(screen.queryByText("not enough data")).not.toBeInTheDocument();
  });

  it("prints not enough data where a count is missing and shows a rep note", () => {
    const review = buildLearningReview({
      campaignStatus: "completed",
      deals: [],
      rings: [],
      scaleShows: [],
      overrides: [
        {
          id: "note-1",
          authorRole: "rep",
          targetKind: "show",
          targetKey: "show-9",
          stance: "test_next",
          note: "rep vouches, test one flight",
        },
      ],
      showNames: { "show-9": "Vouched Show" },
    });
    render(
      <LearningReviewView campaignId="camp-1" campaignName="Sauna test" review={review} />
    );
    expect(screen.getAllByText("not enough data").length).toBeGreaterThan(0);
    expect(screen.getByText("rep vouches, test one flight")).toBeInTheDocument();
    expect(screen.getByText("Vouched Show")).toBeInTheDocument();
    expect(screen.getByText("Score: not enough data")).toBeInTheDocument();
  });
});
