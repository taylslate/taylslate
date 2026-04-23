import { describe, it, expect } from "vitest";
import { derivePostDates, generateIoPdfFromDeal } from "./io-generator";
import type {
  Wave12Deal,
  BrandProfile,
  ShowProfile,
  Outreach,
} from "@/lib/data/types";

const baseDeal: Wave12Deal = {
  id: "deal-uuid-aaaa-bbbb",
  outreach_id: "out-1",
  brand_profile_id: "bp1",
  show_profile_id: "sp1",
  status: "planning",
  agreed_cpm: 28.5,
  agreed_episode_count: 4,
  agreed_placement: "mid-roll",
  agreed_flight_start: "2026-05-01",
  agreed_flight_end: "2026-05-31",
  docusign_envelope_id: null,
  brand_signed_at: null,
  show_signed_at: null,
  signed_io_pdf_url: null,
  signature_certificate_url: null,
  brand_reminder_sent_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  created_at: "2026-04-23T00:00:00Z",
  updated_at: "2026-04-23T00:00:00Z",
};

const baseBrand: BrandProfile = {
  id: "bp1",
  user_id: "u-brand",
  brand_identity: "Aurora Sleep — better mattresses",
  brand_website: "https://aurora.example",
  created_at: "",
  updated_at: "",
};

const baseShow: ShowProfile = {
  id: "sp1",
  user_id: "u-show",
  show_name: "The Daily Briefing",
  audience_size: 12_000,
  episode_cadence: "weekly",
  ad_formats: ["host_read_baked"],
  ad_read_types: ["personal_experience"],
  ad_copy_email: "ads@daily.fm",
  billing_email: "money@daily.fm",
  platform: "podcast",
  created_at: "",
  updated_at: "",
};

const baseOutreach: Outreach = {
  id: "out-1",
  brand_profile_id: "bp1",
  campaign_id: "c1",
  show_name: "The Daily Briefing",
  proposed_cpm: 28.5,
  proposed_episode_count: 4,
  proposed_placement: "mid-roll",
  proposed_flight_start: "2026-05-01",
  proposed_flight_end: "2026-05-31",
  pitch_body: "ignored for PDF rendering",
  sent_to_email: "host@daily.fm",
  response_status: "accepted",
  token: "tok",
  created_at: "",
  updated_at: "",
};

describe("derivePostDates", () => {
  it("emits the requested number of dates", () => {
    const dates = derivePostDates("2026-05-01", "2026-05-31", 4, "weekly");
    expect(dates).toHaveLength(4);
  });

  it("uses cadence spacing when it fits", () => {
    const dates = derivePostDates("2026-05-01", "2026-06-30", 4, "weekly");
    const days = (a: string, b: string) =>
      Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
    expect(days(dates[0], dates[1])).toBe(7);
  });

  it("compresses when cadence × episodes overflows the flight", () => {
    const dates = derivePostDates("2026-05-01", "2026-05-15", 5, "weekly");
    const last = new Date(dates[dates.length - 1]).getTime();
    const end = new Date("2026-05-15").getTime();
    expect(last).toBeLessThanOrEqual(end);
  });

  it("returns empty array for invalid inputs", () => {
    expect(derivePostDates("nope", "2026-01-01", 1, "weekly")).toEqual([]);
    expect(derivePostDates("2026-01-01", "2026-01-10", 0, "weekly")).toEqual([]);
  });
});

describe("generateIoPdfFromDeal", () => {
  it("returns a non-trivial PDF buffer with computed totals", () => {
    const out = generateIoPdfFromDeal({
      deal: baseDeal,
      brandProfile: baseBrand,
      showProfile: baseShow,
      outreach: baseOutreach,
      brandSigningEmail: "brand@aurora.example",
      showSigningEmail: "host@daily.fm",
    });
    expect(out.pdfBuffer.length).toBeGreaterThan(2000);
    // Totals use audience × episodes
    expect(out.totalDownloads).toBe(48_000);
    // 12000 / 1000 × 28.50 × 4 = 1368
    expect(out.totalGross).toBeCloseTo(1368, 2);
    expect(out.totalNet).toBe(out.totalGross);
    expect(out.postDates.length).toBe(4);
  });

  it("uses a deterministic IO number derived from the deal id", () => {
    const a = generateIoPdfFromDeal({
      deal: baseDeal,
      brandProfile: baseBrand,
      showProfile: baseShow,
      outreach: baseOutreach,
      brandSigningEmail: "x",
      showSigningEmail: "y",
    });
    const b = generateIoPdfFromDeal({
      deal: baseDeal,
      brandProfile: baseBrand,
      showProfile: baseShow,
      outreach: baseOutreach,
      brandSigningEmail: "x",
      showSigningEmail: "y",
    });
    expect(a.ioNumber).toBe(b.ioNumber);
  });

  it("falls back when audience size is missing", () => {
    const out = generateIoPdfFromDeal({
      deal: baseDeal,
      brandProfile: baseBrand,
      showProfile: { ...baseShow, audience_size: null as never },
      outreach: baseOutreach,
      brandSigningEmail: "x",
      showSigningEmail: "y",
    });
    expect(out.totalDownloads).toBe(0);
    expect(out.totalGross).toBe(0);
  });
});
