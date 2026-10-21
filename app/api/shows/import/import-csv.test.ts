import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/data/queries", () => ({
  importShows: vi.fn(),
  getUserProfile: vi.fn(),
}));

import { parseCSVToShows } from "./route";

describe("parseCSVToShows geography", () => {
  it("parses a media-kit column into show demographics", () => {
    const csv = [
      "Show Name,Platform,Media kit",
      'Recovery Lab,podcast,"United States 62% | Canada 8%"',
    ].join("\n");
    const shows = parseCSVToShows(csv);
    expect(shows).toHaveLength(1);
    expect(shows[0].demographics).toEqual({ us: 62, canada: 8 });
  });

  it("reads exact country columns and does not invent a share that is blank", () => {
    const csv = ["Show Name,US,UK,Canada", "Night Desk,71,9,"].join("\n");
    const shows = parseCSVToShows(csv);
    expect(shows[0].demographics).toEqual({ us: 71, uk: 9 });
  });

  it("leaves demographics unset when the row has no geography", () => {
    const csv = ["Show Name,Downloads", "Night Desk,12000"].join("\n");
    const shows = parseCSVToShows(csv);
    expect(shows[0].demographics).toBeUndefined();
  });
});
