import { describe, expect, it } from "vitest";
import { extractChannelContactEmails, extractVideoContactEmails, normalizeContactEmail } from "./emails";

describe("contact email extraction", () => {
  it("reads a business address from the channel description", () => {
    const found = extractChannelContactEmails(
      "Business inquiries: ads@show.com\nWe talk about training."
    );
    expect(found).toEqual([{ email: "ads@show.com", source: "channel_description" }]);
  });

  it("reads mailto and About redirect links without fetching them", () => {
    const found = extractChannelContactEmails(
      "Book here mailto:booking@show.com and https://www.youtube.com/redirect?q=mailto%3Ahello%40brand.co&event=channel_description"
    );
    expect(found.map((row) => `${row.source}:${row.email}`).sort()).toEqual([
      "about_link:booking@show.com",
      "about_link:hello@brand.co",
    ]);
  });

  it("reads an email query param on an About URL", () => {
    const found = extractChannelContactEmails("Site https://brand.example/contact?email=press@brand.example");
    expect(found).toEqual([{ email: "press@brand.example", source: "about_link" }]);
  });

  it("reads an obfuscated address in the description", () => {
    const found = extractChannelContactEmails("Sponsorships [at] brand [dot] com");
    expect(found).toEqual([{ email: "sponsorships@brand.com", source: "channel_description" }]);
  });

  it("drops junk and platform addresses", () => {
    expect(normalizeContactEmail("noreply@youtube.com")).toBeNull();
    expect(normalizeContactEmail("name@example.com")).toBeNull();
    expect(normalizeContactEmail("user@test.com")).toBeNull();
    expect(extractChannelContactEmails("logo.png noreply@youtube.com name@example.com ads@show.com")).toEqual([
      { email: "ads@show.com", source: "channel_description" },
    ]);
  });

  it("keeps one row per address and source", () => {
    const found = extractChannelContactEmails("ads@show.com and again ads@show.com");
    expect(found).toEqual([{ email: "ads@show.com", source: "channel_description" }]);
  });

  it("reads a recent video description as its own source", () => {
    const found = extractVideoContactEmails("Sponsor this video at deals@creator.com. mailto:deals@creator.com");
    expect(found).toEqual([{ email: "deals@creator.com", source: "video_description" }]);
  });
});
