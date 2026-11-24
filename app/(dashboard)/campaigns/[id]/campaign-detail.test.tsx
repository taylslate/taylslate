// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Campaign } from "@/lib/data/types";
import CampaignDetail from "./campaign-detail";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const campaign = {
  id: "camp-1",
  user_id: "brand-1",
  name: "Spring",
  brief: {},
  budget_total: 20000,
  platforms: ["podcast", "youtube"],
  status: "planned",
  recommendations: [
    {
      show_id: "show-1",
      show_name: "Harbor",
      platform: "podcast",
      fit_score: 80,
      estimated_cpm: 25,
      audience_size: 10000,
      categories: ["Business"],
      current_sponsors: [],
      allocated_budget: 3000,
      num_episodes: 3,
      placement: "mid-roll",
      estimated_impressions: 30000,
      overlap_flag: false,
      overlap_with: [],
      contact_email: "",
    },
  ],
  youtube_recommendations: [
    {
      show_id: "yt-1",
      show_name: "Channel",
      platform: "youtube",
      fit_score: 70,
      audience_size: 20000,
      categories: ["Tech"],
      current_sponsors: [],
      allocated_budget: 4000,
      flat_fee_per_video: 2000,
      num_videos: 2,
      estimated_views: 40000,
      overlap_flag: false,
      overlap_with: [],
      contact_email: "",
    },
  ],
  created_at: "2026-04-01T00:00:00.000Z",
  updated_at: "2026-04-01T00:00:00.000Z",
} as unknown as Campaign;

afterEach(cleanup);

describe("legacy campaign draft cards", () => {
  it("has no Copy email button and still says Sent through Taylslate", () => {
    render(<CampaignDetail campaign={campaign} />);
    fireEvent.click(screen.getByRole("button", { name: "Outreach Emails" }));
    expect(screen.queryByRole("button", { name: "Copy email" })).toBeNull();
    expect(screen.queryByText("Copy email")).toBeNull();
    expect(screen.getAllByText("Sent through Taylslate")).toHaveLength(2);
    expect(screen.getByText("Harbor")).toBeTruthy();
    expect(screen.getByText("Channel")).toBeTruthy();
  });
});
