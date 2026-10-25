import { readFileSync } from "node:fs";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
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
  SHOW_MATCH_PUNCTUATION,
  buildRecordInserts,
  decideShowMatch,
  detectPastCampaignKind,
  draftsFromExtractedIO,
  matchPastCampaignShows,
  normalizeShowMatchKey,
  parseCsv,
  parsePdf,
  parseSaveBody,
  parseXlsx,
  PastCampaignImportError,
  type PastCampaignDraft,
  type ShowMatchCandidate,
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

  it("rejects an inflated zip before exceljs parses a workbook", async () => {
    const payload = Buffer.alloc(8_000, 0);
    const bomb = zipDeflate("xl/worksheets/sheet1.xml", payload, payload.length);
    await expect(parseXlsx(bomb, { maxUncompressedBytes: 1_000 })).rejects.toThrow(
      /expands past the import size limit/
    );

    const underReported = zipDeflate("xl/worksheets/sheet1.xml", payload, 10);
    await expect(parseXlsx(underReported, { maxUncompressedBytes: 1_000 })).rejects.toThrow(
      PastCampaignImportError
    );
    await expect(parseXlsx(underReported, { maxUncompressedBytes: 1_000 })).rejects.toThrow(
      /expands past the import size limit/
    );
  });
});

function zipDeflate(name: string, data: Buffer, declaredUncompressed: number): Uint8Array {
  const compressed = deflateRawSync(data);
  const crc = crc32(data);
  const fileName = Buffer.from(name);
  const local = Buffer.alloc(30 + fileName.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(declaredUncompressed, 22);
  local.writeUInt16LE(fileName.length, 26);
  fileName.copy(local, 30);

  const central = Buffer.alloc(46 + fileName.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(declaredUncompressed, 24);
  central.writeUInt16LE(fileName.length, 28);
  fileName.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length + compressed.length, 16);
  return new Uint8Array(Buffer.concat([local, compressed, central, eocd]));
}

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
          show_match_status: "matched",
          show_match_reason: "unique_normalized_name",
          show_match_confidence: 1,
          brand_id: "attacker",
          price_type: "flat_rate",
          rate: "25",
          raw: { Show: "Acquired" },
        },
      ],
    });

    expect(parsed).not.toHaveProperty("brand_id");
    expect(JSON.stringify(parsed)).not.toContain("attacker");
    expect(JSON.stringify(parsed)).not.toContain("unique_normalized_name");
    expect(JSON.stringify(parsed)).not.toContain("evil-show");
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

const CALLER = "brand-1";

const CATALOG: ShowMatchCandidate = {
  id: "show-1",
  name: "Acquired",
  is_discoverable: true,
  agent_id: null,
};

describe("normalizeShowMatchKey", () => {
  it("uses the same 32 ASCII punctuation characters as migration 067", () => {
    expect(SHOW_MATCH_PUNCTUATION).toHaveLength(32);
    expect(new Set(SHOW_MATCH_PUNCTUATION).size).toBe(32);
  });

  it.each([
    ["Acquired", "acquired"],
    ["ACQUIRED", "acquired"],
    ["The Acquired", "acquired"],
    ["The The Acquired", "acquired"],
    ["Acquired Podcast", "acquired"],
    ["Acquired Show", "acquired"],
    ["The Acquired Podcast", "acquired"],
    ["The Acquired Show!", "acquired"],
    ["  the   acquired   podcast  ", "acquired"],
    ["the\tacquired\tpodcast", "acquired"],
    ["Odd Lots, Bloomberg", "odd lots bloomberg"],
    ["Joe's Podcast", "joe s"],
    ["Acquired (Podcast)", "acquired"],
    ["My-Show", "my"],
    ["Daily Show Podcast", "daily"],
    ["The Show", "show"],
    ["Show", "show"],
    ["theater", "theater"],
    ["showing", "showing"],
    ["the", "the"],
    ["!!!", ""],
    ["Café Podcast", "café"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeShowMatchKey(input)).toBe(expected);
    expect(normalizeShowMatchKey(normalizeShowMatchKey(input))).toBe(expected);
  });
});

describe("decideShowMatch", () => {
  it("matches one catalog show after normalization", () => {
    expect(decideShowMatch("The Acquired Podcast!", [CATALOG], CALLER)).toEqual({
      matched_show_id: "show-1",
      show_match_status: "matched",
      show_match_reason: "unique_normalized_name",
      show_match_confidence: 1,
    });
  });

  it("leaves a name with no candidate unmatched", () => {
    expect(decideShowMatch("Mystery Hour", [CATALOG], CALLER)).toMatchObject({
      matched_show_id: null,
      show_match_status: "ambiguous",
      show_match_reason: "no_normalized_match",
      show_match_confidence: 0,
    });
  });

  it("leaves two catalog shows unmatched", () => {
    const decision = decideShowMatch(
      "Acquired",
      [CATALOG, { id: "show-2", name: "acquired podcast", is_discoverable: true, agent_id: null }],
      CALLER
    );
    expect(decision).toMatchObject({
      matched_show_id: null,
      show_match_reason: "multiple_normalized_matches",
      show_match_confidence: 0,
    });
  });

  it("does not match a hidden show the caller did not create", () => {
    const decision = decideShowMatch(
      "Secret",
      [{ id: "hid", name: "The Secret Show", is_discoverable: false, agent_id: "other" }],
      CALLER
    );
    expect(decision.matched_show_id).toBeNull();
    expect(decision.show_match_reason).toBe("no_normalized_match");
  });

  it("matches a hidden show the caller created", () => {
    const decision = decideShowMatch(
      "Secret Podcast",
      [{ id: "hid", name: "Secret", is_discoverable: false, agent_id: CALLER }],
      CALLER
    );
    expect(decision).toMatchObject({
      matched_show_id: "hid",
      show_match_status: "matched",
      show_match_confidence: 1,
    });
  });

  it("keeps the catalog match when someone else's hidden show normalizes the same way", () => {
    const decision = decideShowMatch(
      "Acquired",
      [
        CATALOG,
        { id: "hid", name: "The Acquired Podcast", is_discoverable: false, agent_id: "other" },
      ],
      CALLER
    );
    expect(decision.matched_show_id).toBe("show-1");
  });

  it("treats a catalog show plus the caller's hidden show as ambiguous", () => {
    const decision = decideShowMatch(
      "Acquired",
      [CATALOG, { id: "hid", name: "Acquired", is_discoverable: false, agent_id: CALLER }],
      CALLER
    );
    expect(decision.matched_show_id).toBeNull();
    expect(decision.show_match_reason).toBe("multiple_normalized_matches");
  });

  it("does not treat a missing discoverable flag as a catalog show", () => {
    expect(
      decideShowMatch("Acquired", [{ id: "x", name: "Acquired", agent_id: null }], CALLER)
        .matched_show_id
    ).toBeNull();
  });

  it("does not match an empty key to every punctuated name", () => {
    expect(
      decideShowMatch("!!!", [{ id: "x", name: "???", is_discoverable: true, agent_id: null }], CALLER)
        .matched_show_id
    ).toBeNull();
  });

  it("counts one show id once", () => {
    expect(decideShowMatch("Acquired", [CATALOG, { ...CATALOG }], CALLER).matched_show_id).toBe(
      "show-1"
    );
  });
});

describe("buildRecordInserts", () => {
  it("writes the decision and ignores a show id already on the draft", () => {
    const matches = new Map([
      ["acquired", decideShowMatch("The Acquired Podcast", [CATALOG], CALLER)],
    ]);
    const draft: PastCampaignDraft = {
      show_name: "The Acquired Podcast",
      matched_show_id: "evil-show",
      flight_start: null,
      flight_end: null,
      placement: null,
      price_type: null,
      rate: null,
      episodes: null,
      spend: null,
      conversions: null,
      downloads: null,
      raw: {},
    };
    const rows = buildRecordInserts("imp-1", CALLER, [draft], matches);
    expect(rows[0]).toMatchObject({
      import_id: "imp-1",
      brand_id: CALLER,
      show_name: "The Acquired Podcast",
      matched_show_id: "show-1",
      show_match_status: "matched",
      show_match_reason: "unique_normalized_name",
      show_match_confidence: 1,
    });
    expect(JSON.stringify(rows)).not.toContain("evil-show");
  });

  it("stores an empty key as ambiguous and does not ask the catalog", async () => {
    const queried: string[] = [];
    const matches = await matchPastCampaignShows(["!!!", "The Acquired Podcast", "Acquired"], CALLER, async (key) => {
      queried.push(key);
      return [CATALOG];
    });
    expect(queried).toEqual(["acquired"]);
    const rows = buildRecordInserts(
      "imp-1",
      CALLER,
      [
        { ...blankDraft("!!!"), matched_show_id: "evil-show" },
        blankDraft("Acquired"),
      ],
      matches
    );
    expect(rows[0]).toMatchObject({
      matched_show_id: null,
      show_match_reason: "no_normalized_match",
      show_match_confidence: 0,
    });
    expect(rows[1].matched_show_id).toBe("show-1");
  });

  it("saves a failed lookup as no match", async () => {
    const matches = await matchPastCampaignShows(["Acquired"], CALLER, async () => {
      throw new Error("down");
    });
    expect(matches.get("acquired")).toMatchObject({
      matched_show_id: null,
      show_match_reason: "no_normalized_match",
    });
  });
});

function blankDraft(showName: string): PastCampaignDraft {
  return {
    show_name: showName,
    matched_show_id: null,
    flight_start: null,
    flight_end: null,
    placement: null,
    price_type: null,
    rate: null,
    episodes: null,
    spend: null,
    conversions: null,
    downloads: null,
    raw: {},
  };
}
