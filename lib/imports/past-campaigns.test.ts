import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

const { callLLMWithFallback } = vi.hoisted(() => ({
  callLLMWithFallback: vi.fn(),
}));

vi.mock("@/lib/llm/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/llm/client")>("@/lib/llm/client");
  return {
    ...actual,
    callLLMWithFallback: (...args: unknown[]) => callLLMWithFallback(...args),
  };
});

import { loadPrompt } from "@/lib/llm/client";
import {
  PAST_CAMPAIGN_MAX_ROWS,
  detectPastCampaignKind,
  draftsFromExtractedIO,
  parseCsv,
  parsePdf,
  parseSaveBody,
  parseXlsx,
  PastCampaignImportError,
} from "./past-campaigns";

const FIXTURE = path.join(process.cwd(), "lib/imports/fixtures");

const COLUMN_MAP = {
  show_name: "Podcast Title",
  flight_start: "Flight Start",
  flight_end: "Flight End",
  placement: "Read",
  price_type: "Pricing",
  rate: "CPM",
  episodes: "Spots",
  spend: "Total Spend",
  conversions: "Orders",
  downloads: "Audience",
};

const IO = {
  advertiser_name: "SaunaBox",
  publisher_name: "Acquired Media",
  publisher_contact_name: "Ben",
  publisher_contact_email: "ben@acquired.fm",
  line_items: [
    {
      show_name: "Acquired",
      post_date: "2026-02-01",
      guaranteed_downloads: 10000,
      gross_rate: 250,
      gross_cpm: 25,
      net_due: 250,
      price_type: "cpm",
      placement: "mid-roll",
    },
    {
      show_name: "Acquired",
      post_date: "2026-02-08",
      guaranteed_downloads: 10000,
      gross_rate: 250,
      gross_cpm: 25,
      net_due: 250,
      price_type: "cpm",
      placement: "mid-roll",
    },
    {
      show_name: "Odd Lots",
      post_date: "2026-03-01",
      guaranteed_downloads: 5000,
      gross_rate: 800,
      net_due: 800,
      price_type: "flat_rate",
      placement: "pre-roll",
    },
  ],
};

function mappedMessage() {
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(COLUMN_MAP) }],
  };
}

beforeEach(() => {
  callLLMWithFallback.mockReset();
  callLLMWithFallback.mockResolvedValue(mappedMessage());
});

describe("detectPastCampaignKind", () => {
  it("accepts a csv mime and extension pair", () => {
    expect(detectPastCampaignKind({ name: "History.CSV", type: "text/csv; charset=utf-8", size: 12 })).toBe("csv");
  });

  it("rejects a mime that does not match the extension", () => {
    expect(() =>
      detectPastCampaignKind({ name: "history.csv", type: "application/pdf", size: 12 })
    ).toThrow(/does not match/);
  });

  it("rejects files over 10MB", () => {
    expect(() =>
      detectPastCampaignKind({ name: "history.csv", type: "text/csv", size: 10 * 1024 * 1024 + 1 })
    ).toThrow(/10MB/);
  });
});

describe("parseCsv", () => {
  it("normalizes the csv fixture through the model column map", async () => {
    const text = readFileSync(path.join(FIXTURE, "past-campaign.csv"), "utf8");
    const drafts = await parseCsv(text);

    expect(callLLMWithFallback).toHaveBeenCalledTimes(1);
    const input = callLLMWithFallback.mock.calls[0][0];
    expect(input.system).toBe(loadPrompt("past-campaign-mapping.md"));
    expect(input.maxRetries).toBe(0);
    expect(input.system).toContain("show_name");

    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      show_name: "Acquired",
      matched_show_id: null,
      flight_start: "2026-01-06",
      flight_end: "2026-01-20",
      placement: "mid-roll",
      price_type: "cpm",
      rate: 25,
      episodes: 3,
      spend: 2250,
      conversions: 14,
      downloads: 30000,
    });
    expect(drafts[0].raw).toMatchObject({
      "Podcast Title": "Acquired",
      "Total Spend": "$2,250",
    });
    expect(drafts[1]).toMatchObject({
      show_name: "Odd Lots, Bloomberg",
      flight_start: "2026-01-15",
      flight_end: "2026-01-15",
      placement: "pre-roll",
      price_type: "flat",
      rate: 800,
      episodes: 1,
      spend: 800,
      conversions: null,
      downloads: null,
    });
  });

  it("rejects more than 2,000 data rows before calling the model", async () => {
    const lines = ["Show", ...Array.from({ length: PAST_CAMPAIGN_MAX_ROWS + 1 }, (_, i) => `Show ${i}`)];
    await expect(parseCsv(lines.join("\n"))).rejects.toBeInstanceOf(PastCampaignImportError);
    expect(callLLMWithFallback).not.toHaveBeenCalled();
  });

  it("uses a canonical header when the model leaves the field empty", async () => {
    callLLMWithFallback.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ show_name: null, rate: null }) }],
    });
    const drafts = await parseCsv("show_name,rate\nAcquired,25\n");
    expect(drafts[0]).toMatchObject({ show_name: "Acquired", rate: 25, matched_show_id: null });
  });
});

describe("parseXlsx", () => {
  it("reads the first sheet only and keeps date cells", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Campaigns");
    sheet.addRow([
      "Podcast Title",
      "Flight Start",
      "Flight End",
      "Read",
      "Pricing",
      "CPM",
      "Spots",
      "Total Spend",
      "Orders",
      "Audience",
    ]);
    const row = sheet.addRow([
      "Acquired",
      new Date(2026, 0, 6),
      new Date(2026, 0, 20),
      "mid-roll",
      "cpm",
      25,
      3,
      2250,
      14,
      30000,
    ]);
    row.getCell(2).numFmt = "yyyy-mm-dd";
    row.getCell(3).numFmt = "yyyy-mm-dd";
    const other = workbook.addWorksheet("Ignore");
    other.addRow(["Podcast Title"]);
    other.addRow(["Ghost Show"]);

    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    const drafts = await parseXlsx(bytes);

    expect(drafts.map((draft) => draft.show_name)).toEqual(["Acquired"]);
    expect(drafts[0]).toMatchObject({
      flight_start: "2026-01-06",
      flight_end: "2026-01-20",
      price_type: "cpm",
      rate: 25,
      episodes: 3,
      spend: 2250,
      downloads: 30000,
      matched_show_id: null,
    });
    expect(drafts[0].raw["Podcast Title"]).toBe("Acquired");
    expect(JSON.stringify(drafts)).not.toContain("Ghost Show");
  });
});

describe("parsePdf", () => {
  it("maps an extracted IO into one draft per show", async () => {
    const bytes = new Uint8Array(readFileSync(path.join(FIXTURE, "past-campaign.pdf")));
    const extractIo = vi.fn(async () => IO);
    const drafts = await parsePdf(bytes, { extractIo });

    expect(extractIo).toHaveBeenCalledWith(bytes);
    expect(callLLMWithFallback).not.toHaveBeenCalled();
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      show_name: "Acquired",
      matched_show_id: null,
      flight_start: "2026-02-01",
      flight_end: "2026-02-08",
      placement: "mid-roll",
      price_type: "cpm",
      rate: 25,
      episodes: 2,
      spend: 500,
      conversions: null,
      downloads: 10000,
    });
    expect(drafts[0].raw).toMatchObject({ show_name: "Acquired" });
    expect((drafts[0].raw.line_items as unknown[])).toHaveLength(2);
    expect(drafts[1]).toMatchObject({
      show_name: "Odd Lots",
      price_type: "flat",
      rate: 800,
      episodes: 1,
      spend: 800,
      placement: "pre-roll",
      flight_start: "2026-03-01",
      flight_end: "2026-03-01",
      downloads: 5000,
    });
  });

  it("rejects an IO that fails extraction validation", () => {
    expect(() => draftsFromExtractedIO({ line_items: [] })).toThrow(PastCampaignImportError);
  });
});

describe("parseSaveBody", () => {
  it("ignores a client brand id and flattens flat_rate", () => {
    const parsed = parseSaveBody({
      brand_id: "attacker",
      import_id: "attacker-import",
      source_kind: "csv",
      file_name: "folder/past-campaign.csv",
      pooling_consent: false,
      terms_version: "should-drop",
      records: [
        {
          show_name: "Acquired",
          matched_show_id: "evil-show",
          brand_id: "attacker",
          price_type: "flat_rate",
          rate: "25",
          raw: { Show: "Acquired" },
        },
      ],
    });

    expect(parsed).not.toHaveProperty("brand_id");
    expect(JSON.stringify(parsed)).not.toContain("attacker");
    expect(parsed.file_name).toBe("past-campaign.csv");
    expect(parsed.pooling_consent).toBe(false);
    expect(parsed.terms_version).toBeNull();
    expect(parsed.drafts[0]).toMatchObject({
      show_name: "Acquired",
      matched_show_id: null,
      price_type: "flat",
      rate: 25,
      raw: { Show: "Acquired" },
    });
  });

  it("requires a terms version when consent is true", () => {
    expect(() =>
      parseSaveBody({
        source_kind: "pdf",
        pooling_consent: true,
        records: [{ show_name: "Acquired" }],
      })
    ).toThrow(/terms_version/);
  });
});
