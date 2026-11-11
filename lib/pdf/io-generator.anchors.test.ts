// DocuSign places signature and date tabs on the exact anchor strings drawn
// into the IO PDF. This file records every jsPDF text call for a fixed deal
// and checks that a missing promo code leaves that list identical to the
// baseline taken from the generator before the promo row existed.
//
// jsPDF 4 assigns text, addPage, and setPage as own properties inside the
// constructor and returns that object, so jsPDF.prototype.text is undefined
// and a prototype spy never sees a call. The recorder wraps each document's
// text method and reads the current page (the page addPage and setPage move)
// at the moment of the call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SIGNATURE_ANCHORS } from "@/lib/docusign/anchors";
import type { IoPdfSaved } from "./io-terms";
import type { BrandProfile, Outreach, ShowProfile, Wave12Deal } from "@/lib/data/types";
import { generateIoPdfFromDeal, type IoPdfInput } from "./io-generator";

const MARGIN = 40;
const PAGE_WIDTH = 612;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const VALUE_COLUMN_WIDTH = CONTENT_WIDTH - 110;
const PAGE_BOTTOM = 752;

type DrawnText = string | string[];

type TextCall = {
  text: DrawnText;
  x: number;
  y: number;
  page: number;
  fontSize: number;
  color: string;
};

type BaselineCall = {
  text: DrawnText;
  x: number;
  y: number;
  page: number;
};

const recorder = vi.hoisted(() => {
  const calls: TextCall[] = [];

  function install(doc: {
    text: (text: DrawnText, x: number, y: number, options?: object, transform?: unknown) => unknown;
    getFontSize: () => number;
    getTextColor: () => string;
    getCurrentPageInfo: () => { pageNumber: number };
  }): void {
    const origText = doc.text.bind(doc);
    doc.text = (text, x, y, options, transform) => {
      calls.push({
        text: Array.isArray(text) ? [...text] : text,
        x,
        y,
        page: doc.getCurrentPageInfo().pageNumber,
        fontSize: doc.getFontSize(),
        color: doc.getTextColor(),
      });
      return origText(text, x, y, options, transform);
    };
  }

  return {
    calls,
    install,
    reset() {
      calls.length = 0;
    },
  };
});

vi.mock("jspdf", async () => {
  const actual = await vi.importActual<typeof import("jspdf")>("jspdf");
  const Orig = actual.jsPDF;
  function RecordingJsPDF(
    this: unknown,
    ...args: ConstructorParameters<typeof Orig>
  ): InstanceType<typeof Orig> {
    const doc = new Orig(...args);
    recorder.install(doc);
    return doc;
  }
  return { ...actual, jsPDF: RecordingJsPDF as unknown as typeof Orig };
});

const baselinePath = fileURLToPath(
  new URL("./__fixtures__/io-anchor-baseline.json", import.meta.url)
);

const realToLocaleDateString = Date.prototype.toLocaleDateString;
const realNumberToLocale = Number.prototype.toLocaleString;

const savedTerms: IoPdfSaved = {
  payment_off_platform: false,
  payment_terms: null,
  exclusivity_days: 90,
  rofr_days: 30,
  rofr_enabled: true,
  cancellation_notice_days: 14,
  download_tracking_days: 45,
  download_tracking_enabled: true,
  make_good_threshold: 0.1,
  make_good_enabled: true,
  agency_name: null,
  agency_contact_name: null,
  agency_contact_email: null,
  payer: "brand",
};

const deal: Wave12Deal = {
  id: "deal-io1-fixture-0001",
  outreach_id: "out-io1",
  brand_profile_id: "bp-io1",
  show_profile_id: "sp-io1",
  status: "planning",
  agreed_cpm: 25,
  agreed_episode_count: 3,
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
  promo_code: null,
  created_at: "2026-04-23T00:00:00.000Z",
  updated_at: "2026-04-23T00:00:00.000Z",
};

const brandProfile: BrandProfile = {
  id: "bp-io1",
  user_id: "user-brand",
  brand_name: "Northwind",
  brand_website: "https://northwind.example",
  created_at: "2026-04-01T00:00:00.000Z",
  updated_at: "2026-04-01T00:00:00.000Z",
};

const showProfile: ShowProfile = {
  id: "sp-io1",
  user_id: "user-show",
  show_name: "Harbor Light",
  audience_size: 10_000,
  episode_cadence: "weekly",
  ad_formats: ["host_read_baked"],
  ad_read_types: ["personal_experience"],
  ad_copy_email: "ads@harbor.example",
  billing_email: "billing@harbor.example",
  platform: "podcast",
  created_at: "2026-04-01T00:00:00.000Z",
  updated_at: "2026-04-01T00:00:00.000Z",
};

const outreach: Outreach = {
  id: "out-io1",
  brand_profile_id: "bp-io1",
  campaign_id: "camp-io1",
  show_name: "Harbor Light",
  proposed_cpm: 25,
  proposed_episode_count: 3,
  proposed_placement: "mid-roll",
  proposed_flight_start: "2026-05-01",
  proposed_flight_end: "2026-05-31",
  pitch_body: "Fixture pitch. Not drawn as a promo code.",
  sent_to_email: "host@harbor.example",
  response_status: "accepted",
  token: "fixture-token",
  created_at: "2026-04-01T00:00:00.000Z",
  updated_at: "2026-04-01T00:00:00.000Z",
};

function fixtureInput(promo: string | null | undefined): IoPdfInput {
  const next: Wave12Deal = { ...deal };
  if (promo === undefined) delete next.promo_code;
  else next.promo_code = promo;
  return {
    deal: next,
    brandProfile,
    showProfile,
    outreach,
    brandSigningEmail: "brand@northwind.example",
    showSigningEmail: "host@harbor.example",
    ioNumber: "TS-IO-FIXTURE-0001",
    saved: savedTerms,
  };
}

function toBaseline(calls: TextCall[]): BaselineCall[] {
  return calls.map(({ text, x, y, page }) => ({
    text: Array.isArray(text) ? [...text] : text,
    x,
    y,
    page,
  }));
}

function render(promo: string | null | undefined): TextCall[] {
  recorder.reset();
  generateIoPdfFromDeal(fixtureInput(promo));
  return recorder.calls.map((call) => ({
    ...call,
    text: Array.isArray(call.text) ? [...call.text] : call.text,
  }));
}

function loadBaseline(): BaselineCall[] {
  return JSON.parse(readFileSync(baselinePath, "utf8")) as BaselineCall[];
}

function linesOf(call: TextCall): string[] {
  return Array.isArray(call.text) ? call.text : [call.text];
}

function callsContaining(calls: TextCall[], needle: string): TextCall[] {
  return calls.filter((call) => linesOf(call).some((line) => line === needle));
}

function isWhite(color: string): boolean {
  return color.toLowerCase() === "#ffffff";
}

describe("IO PDF promo code and DocuSign anchors", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      now: new Date("2026-04-23T12:00:00.000Z"),
      toFake: ["Date"],
    });
    vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (
      this: Date,
      locales,
      options
    ) {
      const opts = { timeZone: "UTC", ...(options ?? {}) };
      return realToLocaleDateString.call(
        this,
        locales as Intl.LocalesArgument,
        opts
      );
    });
    vi.spyOn(Number.prototype, "toLocaleString").mockImplementation(function (
      this: Number,
      locales,
      options
    ) {
      return realNumberToLocale.call(
        this,
        "en-US",
        options as Intl.NumberFormatOptions | undefined
      );
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.skipIf(process.env.RECORD_IO_BASELINE !== "1")(
    "records the anchor baseline from the current generator",
    () => {
      const calls = toBaseline(render(null));
      mkdirSync(dirname(baselinePath), { recursive: true });
      writeFileSync(baselinePath, `${JSON.stringify(calls, null, 2)}\n`);
      expect(calls.length).toBeGreaterThan(20);
    }
  );

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["blank", "   "],
  ] as const)(
    "promo code %s matches the anchor baseline exactly",
    (_label, promo) => {
      expect(toBaseline(render(promo))).toEqual(loadBaseline());
    }
  );

  it("keeps the four DocuSign anchor strings", () => {
    expect(SIGNATURE_ANCHORS.advertiser).toBe("Advertiser Signature Tab");
    expect(SIGNATURE_ANCHORS.publisher).toBe("Publisher Signature Tab");
    expect(SIGNATURE_ANCHORS.advertiserDate).toBe("Advertiser Date Tab");
    expect(SIGNATURE_ANCHORS.publisherDate).toBe("Publisher Date Tab");
  });

  it("draws SHOW20 once between the last term and STANDARD TERMS", () => {
    const calls = render("SHOW20");
    const baseline = loadBaseline();
    const promoLabels = callsContaining(calls, "Promo Code:");
    const promoValues = callsContaining(calls, "SHOW20");
    expect(promoLabels).toHaveLength(1);
    expect(promoValues).toHaveLength(1);

    const makeGood = calls.findIndex((call) => call.text === "Make-Good:");
    const promoLabelAt = calls.indexOf(promoLabels[0]);
    const promoValueAt = calls.indexOf(promoValues[0]);
    const standardAt = calls.findIndex((call) => call.text === "STANDARD TERMS");
    expect(makeGood).toBeGreaterThanOrEqual(0);
    expect(promoLabelAt).toBeGreaterThan(makeGood);
    expect(promoValueAt).toBe(promoLabelAt + 1);
    expect(standardAt).toBeGreaterThan(promoValueAt);

    const label = promoLabels[0];
    const value = promoValues[0];
    expect(label.text).toBe("Promo Code:");
    expect(label.x).toBe(MARGIN);
    expect(value.x).toBe(MARGIN + 110);
    expect(value.y).toBe(label.y);
    expect(linesOf(value)).toEqual(["SHOW20"]);

    const anchors = [
      SIGNATURE_ANCHORS.advertiser,
      SIGNATURE_ANCHORS.publisher,
      SIGNATURE_ANCHORS.advertiserDate,
      SIGNATURE_ANCHORS.publisherDate,
    ] as const;
    const drawn = Object.fromEntries(
      anchors.map((anchor) => [anchor, callsContaining(calls, anchor)])
    );
    for (const anchor of anchors) {
      expect(drawn[anchor]).toHaveLength(1);
      expect(drawn[anchor][0].fontSize).toBe(6);
      expect(isWhite(drawn[anchor][0].color)).toBe(true);
      expect(drawn[anchor][0].y).toBeLessThan(PAGE_BOTTOM);
    }

    const advertiser = drawn[SIGNATURE_ANCHORS.advertiser][0];
    const publisher = drawn[SIGNATURE_ANCHORS.publisher][0];
    const advertiserDate = drawn[SIGNATURE_ANCHORS.advertiserDate][0];
    const publisherDate = drawn[SIGNATURE_ANCHORS.publisherDate][0];
    const baselinePublisher = baseline.find(
      (call) => call.text === SIGNATURE_ANCHORS.publisher
    );
    const baselineAdvertiser = baseline.find(
      (call) => call.text === SIGNATURE_ANCHORS.advertiser
    );
    const baselineAdvertiserDate = baseline.find(
      (call) => call.text === SIGNATURE_ANCHORS.advertiserDate
    );
    const baselinePublisherDate = baseline.find(
      (call) => call.text === SIGNATURE_ANCHORS.publisherDate
    );
    expect(baselinePublisher).toBeTruthy();
    expect(baselineAdvertiser).toBeTruthy();
    expect(baselineAdvertiserDate).toBeTruthy();
    expect(baselinePublisherDate).toBeTruthy();

    expect(advertiser.x).toBe(MARGIN);
    expect(publisher.x).toBe(baselinePublisher!.x);
    expect(advertiserDate.x).toBe(advertiser.x);
    expect(publisherDate.x).toBe(publisher.x);
    expect(advertiserDate.y).toBe(advertiser.y + 30);
    expect(publisherDate.y).toBe(publisher.y + 30);
    expect(baselineAdvertiserDate!.y - baselineAdvertiser!.y).toBe(30);
    expect(baselinePublisherDate!.y - baselinePublisher!.y).toBe(30);
    expect(advertiser.page).toBe(publisher.page);
    expect(advertiser.y).toBe(publisher.y);
  });

  it("wraps a 64-character promo code inside the value column", async () => {
    const code = "W".repeat(64);
    const calls = render(code);
    const value = calls.find(
      (call) => Array.isArray(call.text) && call.text.join("") === code
    );
    expect(value).toBeTruthy();
    const lines = linesOf(value!);
    expect(lines.length).toBeGreaterThan(1);
    expect(value!.x).toBe(MARGIN + 110);
    expect(lines.every((line) => line.length < code.length)).toBe(true);

    const { jsPDF } = await vi.importActual<typeof import("jspdf")>("jspdf");
    const measure = new jsPDF({ unit: "pt", format: "letter" });
    measure.setFont("helvetica", "normal");
    measure.setFontSize(8);
    for (const line of lines) {
      expect(measure.getTextWidth(line)).toBeLessThanOrEqual(VALUE_COLUMN_WIDTH);
    }

    const standard = calls.find((call) => call.text === "STANDARD TERMS");
    expect(standard).toBeTruthy();
    const lineHeight = 8 * 1.15;
    if (standard!.page === value!.page) {
      expect(standard!.y).toBeGreaterThan(
        value!.y + (lines.length - 1) * lineHeight
      );
    } else {
      expect(standard!.page).toBeGreaterThan(value!.page);
    }

    const promoLabel = calls.find((call) => call.text === "Promo Code:");
    expect(promoLabel).toBeTruthy();
    expect(standard!.page > promoLabel!.page || standard!.y > promoLabel!.y).toBe(
      true
    );
  });
});
