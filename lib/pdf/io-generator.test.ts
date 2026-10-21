import { describe, it, expect } from "vitest";
import { derivePostDates, generateIoPdfFromDeal, type IoLineItemDraft } from "./io-generator";
import type { IoPdfSaved } from "./io-terms";
import { formatDateOnly } from "@/lib/format/date-only";
import { SIGNATURE_ANCHORS } from "@/lib/docusign/anchors";
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

  it("emits exact UTC date-only strings (no timezone drift)", () => {
    // Weekly spacing from a date-only start; must land on exact UTC calendar days
    // regardless of the runner's local zone (uses UTC date arithmetic).
    expect(derivePostDates("2026-05-01", "2026-06-30", 4, "weekly")).toEqual([
      "2026-05-01",
      "2026-05-08",
      "2026-05-15",
      "2026-05-22",
    ]);
  });

  it("uses 3-day spacing for the multiple_weekly cadence", () => {
    expect(derivePostDates("2026-05-01", "2026-05-31", 4, "multiple_weekly")).toEqual([
      "2026-05-01",
      "2026-05-04",
      "2026-05-07",
      "2026-05-10",
    ]);
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

// The signed IO is the document of record: its flight + post dates are date-only
// values that MUST render the same calendar day as the pitch page, deal view, and
// outreach email — i.e. via formatDateOnly (UTC), never a timezone-naive formatter
// that shifts them a day for negative-offset viewers.
describe("IO PDF date-only rendering (matches pitch/deal/email)", () => {
  // jsPDF is created without compression, so drawn text lands in the content
  // stream as readable bytes we can search.
  const pdfText = () => {
    const out = generateIoPdfFromDeal({
      deal: baseDeal, // flight 2026-05-01 → 2026-05-31, weekly, 4 eps
      brandProfile: baseBrand,
      showProfile: baseShow,
      outreach: baseOutreach,
      brandSigningEmail: "x",
      showSigningEmail: "y",
    });
    return { text: out.pdfBuffer.toString("latin1"), postDates: out.postDates };
  };

  it("renders flight dates in UTC (day-correct), independent of the runner timezone", () => {
    const { text } = pdfText();
    // formatDateOnly is UTC-pinned, so these strings are stable everywhere.
    expect(formatDateOnly("2026-05-01")).toBe("May 1, 2026");
    expect(formatDateOnly("2026-05-31")).toBe("May 31, 2026");
    expect(text).toContain("May 1, 2026");
    expect(text).toContain("May 31, 2026");
    // The day-before must never leak in from a naive local-zone format.
    expect(text).not.toContain("Apr 30, 2026");
  });

  it("renders each line-item post date through the same UTC helper", () => {
    const { text, postDates } = pdfText();
    expect(postDates.length).toBe(4);
    for (const iso of postDates) {
      expect(text).toContain(formatDateOnly(iso));
    }
  });
});

// Deterministic regression guard (TZ-independent): pin the targeted split so a
// future edit can't route date-only values back through the naive formatter, nor
// force UTC on the real timestamps.
describe("io-generator date-formatter split", () => {
  it("uses formatDateOnly for flight + post dates and fmtDate for timestamps", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("./io-generator.ts", import.meta.url)), "utf8");

    // Date-only values → shared UTC helper.
    expect(src).toContain("formatDateOnly(deal.agreed_flight_start)");
    expect(src).toContain("formatDateOnly(deal.agreed_flight_end)");
    expect(src).toContain("li.post_date ? formatDateOnly(li.post_date)");
    // ...never the naive local formatter.
    expect(src).not.toContain("fmtDate(deal.agreed_flight");
    expect(src).not.toContain("fmtDate(li.post_date)");

    // Real timestamps stay on the local-zone formatter.
    expect(src).toContain("fmtDate(deal.created_at)");
    expect(src).toContain("fmtDate(signedAt)");
  });
});

// Regression guard for the DocuSign anchor bug (July 2026): createEnvelope
// places SignHere tabs by these EXACT strings, so the generated IO MUST contain
// them (rendered as invisible white text at the signature lines). If they ever
// drift or go missing again, real envelopes get created with no signature tabs
// — DocuSign silently drops an anchor tab whose string it can't find, so the
// failure is invisible without this test. Same source of truth as envelope.ts:
// lib/docusign/anchors.ts.
describe("io-generator renders DocuSign signature anchors", () => {
  it("embeds all SIGNATURE_ANCHORS strings (SignHere + DateSigned) in the PDF content stream", () => {
    const out = generateIoPdfFromDeal({
      deal: baseDeal,
      brandProfile: baseBrand,
      showProfile: baseShow,
      outreach: baseOutreach,
      brandSigningEmail: "x",
      showSigningEmail: "y",
    });
    const text = out.pdfBuffer.toString("latin1");
    expect(text).toContain(SIGNATURE_ANCHORS.advertiser);
    expect(text).toContain(SIGNATURE_ANCHORS.publisher);
    // DateSigned anchors — without these rendered, DocuSign silently drops the
    // date tab and the completed IO has no date stamp (the bug this fixes).
    expect(text).toContain(SIGNATURE_ANCHORS.advertiserDate);
    expect(text).toContain(SIGNATURE_ANCHORS.publisherDate);
  });
});

// The lineItems array is what send-to-docusign persists to io_line_items —
// the DB rows, the PDF table, and the eventual chargeForEpisode amount must
// all come from these exact values.
describe("generateIoPdfFromDeal lineItems (persistence source of truth)", () => {
  const render = (showOverrides: Partial<ShowProfile> = {}) =>
    generateIoPdfFromDeal({
      deal: baseDeal,
      brandProfile: baseBrand,
      showProfile: { ...baseShow, ...showOverrides } as ShowProfile,
      outreach: baseOutreach,
      brandSigningEmail: "x",
      showSigningEmail: "y",
    });

  it("emits one draft per episode with cents-rounded economics the PDF also renders", () => {
    // 12,345 downloads × $28.50 CPM = $351.8325 → must round to $351.83 in
    // the drafts, and totals must derive from the ROUNDED items (DECIMAL(10,2)
    // would otherwise round on insert and drift from the PDF).
    const out = render({ audience_size: 12_345 });
    expect(out.lineItems).toHaveLength(4);
    for (const li of out.lineItems) {
      expect(li.gross_rate).toBe(351.83);
      expect(li.net_due).toBe(351.83);
      expect(li.gross_cpm).toBe(28.5);
      expect(li.guaranteed_downloads).toBe(12_345);
      expect(li.price_type).toBe("cpm");
      expect(li.verified).toBe(false);
      expect(li.make_good_triggered).toBe(false);
    }
    expect(out.totalGross).toBe(1407.32); // 351.83 × 4, not 1407.33
    expect(out.totalNet).toBe(out.totalGross);
    expect(out.totalDownloads).toBe(49_380);
    const text = out.pdfBuffer.toString("latin1");
    expect(text).toContain("351.83");
    expect(text).toContain("1,407.32");
    expect(text).toContain("platform fee on top");
  });

  it("carries post dates, placement, and show name into every draft", () => {
    const out = render();
    expect(out.lineItems.map((li) => li.post_date)).toEqual(out.postDates);
    for (const li of out.lineItems) {
      expect(li.placement).toBe("mid-roll");
      expect(li.show_name).toBe("The Daily Briefing");
      expect(li.content_type).toBe("evergreen");
      expect(li.pixel_required).toBe(false);
    }
  });

  it("maps platform to the io_line_items format CHECK ('both' → podcast)", () => {
    expect(render({ platform: "podcast" }).lineItems[0].format).toBe("podcast");
    expect(render({ platform: "youtube" }).lineItems[0].format).toBe("youtube");
    expect(render({ platform: "both" as never }).lineItems[0].format).toBe("podcast");
    expect(render({ platform: null as never }).lineItems[0].format).toBe("podcast");
  });

  it("derives reader flags from ad_read_types (row matches the printed details line)", () => {
    const personal = render(); // baseShow: ["personal_experience"]
    expect(personal.lineItems[0].is_personal_experience).toBe(true);
    expect(personal.lineItems[0].is_scripted).toBe(false);
    expect(personal.lineItems[0].reader_type).toBe("host_read");

    const scripted = render({ ad_read_types: ["scripted"] });
    expect(scripted.lineItems[0].is_scripted).toBe(true);
    expect(scripted.lineItems[0].is_personal_experience).toBe(false);

    const none = render({ ad_read_types: undefined as never });
    expect(none.lineItems[0].is_scripted).toBe(false);
    expect(none.lineItems[0].is_personal_experience).toBe(false);
  });

  it("zero audience produces $0 drafts (persistence layer must reject these)", () => {
    const out = render({ audience_size: null as never });
    expect(out.lineItems).toHaveLength(4);
    expect(out.lineItems[0].gross_rate).toBe(0);
    expect(out.totalGross).toBe(0);
  });
});

function dealPdf(saved?: IoPdfSaved): string {
  return generateIoPdfFromDeal({
    deal: baseDeal,
    brandProfile: baseBrand,
    showProfile: baseShow,
    outreach: baseOutreach,
    brandSigningEmail: "x",
    showSigningEmail: "y",
    saved,
  }).pdfBuffer.toString("latin1");
}

function savedLine(overrides: Partial<IoLineItemDraft> = {}): IoLineItemDraft {
  return {
    format: "podcast",
    post_date: "2026-05-01",
    guaranteed_downloads: 12_000,
    show_name: "The Daily Briefing",
    placement: "mid-roll",
    is_scripted: false,
    is_personal_experience: true,
    reader_type: "host_read",
    content_type: "evergreen",
    pixel_required: false,
    gross_rate: 342,
    gross_cpm: 28.5,
    price_type: "cpm",
    net_due: 342,
    verified: false,
    make_good_triggered: false,
    ...overrides,
  };
}

describe("negotiated IO terms on the DocuSign PDF", () => {
  it("renders an unedited IO the way it does today, in calendar days", () => {
    const text = dealPdf();
    expect(text).toContain("Pay-as-delivers via Taylslate");
    expect(text).toContain("platform fee on top");
    expect(text).toContain("billing@taylslate.com");
    expect(text).toContain("Generated by Taylslate");
    expect(text).toContain("30-day right of first refusal");
    expect(text).toContain("45-day tracking window");
    expect(text).toContain("Make-Good:");
    expect(text).toContain("14 calendar days written notice");
    expect(text).not.toContain("business days");
    expect(text).not.toContain("Agency of Record");
    expect(text).toContain("Mid-roll");
    expect(text).toContain("28.50");
    expect(text).toContain("12,000");
    expect(text).toContain(SIGNATURE_ANCHORS.advertiser);
    expect(text).toContain(SIGNATURE_ANCHORS.publisher);
  });

  it("prints the free-text payment term and drops Taylslate fee wording when off-platform", () => {
    const text = dealPdf({
      payment_off_platform: true,
      payment_terms: "Net 30 via ACH",
    });
    expect(text).toContain("Net 30 via ACH");
    expect(text).not.toContain("platform fee");
    expect(text).not.toContain("Pay-as-delivers");
    expect(text).not.toContain("billing@taylslate.com");
    expect(text).not.toContain("Taylslate");
  });

  it("prices a flat line per spot and leaves CPM and downloads blank", () => {
    const out = generateIoPdfFromDeal({
      deal: baseDeal,
      brandProfile: baseBrand,
      showProfile: baseShow,
      outreach: baseOutreach,
      brandSigningEmail: "x",
      showSigningEmail: "y",
      saved: {
        lineItems: [
          savedLine({
            price_type: "flat_rate",
            gross_rate: 2500,
            net_due: 2500,
            gross_cpm: 40,
            guaranteed_downloads: 50_000,
          }),
        ],
      },
    });
    const text = out.pdfBuffer.toString("latin1");
    expect(text).toContain("Flat, $2,500.00 per spot");
    expect(text).toContain("2,500.00");
    expect(text).not.toContain("50,000");
    expect(text).not.toContain("40.00");
    expect(out.totalGross).toBe(2500);
    expect(out.totalNet).toBe(2500);
    expect(out.totalDownloads).toBe(0);
  });

  it("prints a creator surface add-on on the PDF DocuSign attaches", () => {
    const surfaceId = "11111111-1111-4111-8111-111111111111";
    const out = generateIoPdfFromDeal({
      deal: baseDeal,
      brandProfile: baseBrand,
      showProfile: baseShow,
      outreach: baseOutreach,
      brandSigningEmail: "x",
      showSigningEmail: "y",
      saved: {
        lineItems: [
          savedLine(),
          savedLine({
            show_surface_id: surfaceId,
            spot_format: "Newsletter mention · creator posts · 7-day lead",
            price_type: "flat_rate",
            gross_rate: 500,
            net_due: 500,
            gross_cpm: 0,
            guaranteed_downloads: 8000,
            post_date: "2026-05-01",
          }),
        ],
      },
    });
    const text = out.pdfBuffer.toString("latin1");
    expect(text).toContain("Add-on: Newsletter mention");
    expect(text).toContain("Flat, $500.00 per spot");
    expect(out.lineItems[1].show_surface_id).toBe(surfaceId);
    const attached = Buffer.from(out.pdfBuffer.toString("base64"), "base64").toString("latin1");
    expect(attached).toContain("Add-on: Newsletter mention");
    expect(attached).toContain(SIGNATURE_ANCHORS.advertiser);
    expect(attached).toContain(SIGNATURE_ANCHORS.publisher);
  });

  it("uses each line's placement and format", () => {
    const text = dealPdf({
      lineItems: [
        savedLine({ placement: "pre-roll", spot_format: "Host-read" }),
        savedLine({
          placement: "post-roll",
          spot_format: "Produced",
          post_date: "2026-05-08",
        }),
      ],
    });
    expect(text).toContain("Pre-roll");
    expect(text).toContain("Post-roll");
    expect(text).toContain("Host-read");
    expect(text).toContain("Produced");
    expect(text).not.toContain("Mid-roll");
  });

  it("names the agency of record, states who pays, and keeps both signature anchors", () => {
    const text = dealPdf({
      agency_name: "Left Field",
      agency_contact_name: "Alex Rivera",
      agency_contact_email: "alex@leftfield.example",
      payer: "agency",
    });
    expect(text).toContain("AGENCY OF RECORD");
    expect(text).toContain("Left Field");
    expect(text).toContain("Alex Rivera, alex@leftfield.example");
    expect(text).toContain("Agency of record");
    expect(text).toContain(SIGNATURE_ANCHORS.advertiser);
    expect(text).toContain(SIGNATURE_ANCHORS.advertiserDate);
    expect(text).toContain(SIGNATURE_ANCHORS.publisher);
    expect(text).toContain(SIGNATURE_ANCHORS.publisherDate);
  });

  it("leaves a switched-off term out and keeps the others", () => {
    const rofrOff = dealPdf({ rofr_enabled: false });
    expect(rofrOff).not.toContain("right of first refusal");
    expect(rofrOff).toContain("tracking window");
    expect(rofrOff).toContain("Make-Good:");

    const trackingOff = dealPdf({ download_tracking_enabled: false });
    expect(trackingOff).not.toContain("tracking window");
    expect(trackingOff).toContain("right of first refusal");
    expect(trackingOff).toContain("Make-Good:");

    const makeGoodOff = dealPdf({ make_good_enabled: false });
    expect(makeGoodOff).not.toContain("Make-Good:");
    expect(makeGoodOff).toContain("tracking window");
    expect(makeGoodOff).toContain("right of first refusal");
  });
});
