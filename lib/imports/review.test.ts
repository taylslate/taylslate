import { describe, expect, it } from "vitest";
import {
  catalogSuggestionLabel,
  defaultPoolingConsent,
  draftsToRows,
  messageFromApi,
  POOLING_TERMS_VERSION,
  ReviewInputError,
  rowEditErrors,
  rowsToSaveBody,
  type ParsedDraft,
} from "./review";

const BRAND_A = "11111111-1111-4111-8111-111111111111";
const BRAND_B = "22222222-2222-4222-8222-222222222222";
const SHOW_ID = "8f3c1a20-4b6e-4c11-9a2d-111111111111";

function draft(overrides: Partial<ParsedDraft> = {}): ParsedDraft {
  return {
    show_name: "Acquired",
    matched_show_id: SHOW_ID,
    flight_start: "2025-06-02",
    flight_end: "2025-06-23",
    placement: "mid-roll",
    price_type: "cpm",
    rate: 28,
    episodes: 3,
    spend: 5100,
    conversions: 86,
    downloads: 180000,
    raw: { Podcast: "Acquired" },
    ...overrides,
  };
}

describe("rowsToSaveBody", () => {
  it("maps a parsed draft into the save body without linking a show", () => {
    const rows = draftsToRows([draft()]);
    const body = rowsToSaveBody({
      brandId: BRAND_A,
      sourceKind: "csv",
      fileName: "sauna-box-q1.csv",
      rows,
    });

    expect(body).toEqual({
      brand_id: BRAND_A,
      source_kind: "csv",
      file_name: "sauna-box-q1.csv",
      pooling_consent: false,
      terms_version: null,
      records: [
        {
          show_name: "Acquired",
          matched_show_id: null,
          flight_start: "2025-06-02",
          flight_end: "2025-06-23",
          placement: "mid-roll",
          price_type: "cpm",
          rate: 28,
          episodes: 3,
          spend: 5100,
          conversions: 86,
          downloads: 180000,
          raw: { Podcast: "Acquired" },
        },
      ],
    });
    expect(body.brand_id).not.toBe(BRAND_B);
    expect(JSON.stringify(body)).not.toContain(SHOW_ID);
  });

  it("blocks a row with an invalid price", () => {
    const rows = draftsToRows([draft({ rate: "" })]);
    rows[0].price = "not-a-price";

    expect(rowEditErrors(rows)).toEqual([
      {
        id: "row-1",
        field: "price",
        message: "Enter a price as a number, or leave it blank.",
      },
    ]);
    expect(() =>
      rowsToSaveBody({
        brandId: BRAND_A,
        sourceKind: "xlsx",
        fileName: "q1.xlsx",
        rows,
      })
    ).toThrow(ReviewInputError);
    expect(() =>
      rowsToSaveBody({
        brandId: BRAND_A,
        sourceKind: "xlsx",
        fileName: "q1.xlsx",
        rows,
      })
    ).toThrow("Enter a price as a number, or leave it blank.");
  });

  it("defaults pooling consent to false", () => {
    expect(defaultPoolingConsent()).toBe(false);
    const body = rowsToSaveBody({
      brandId: BRAND_A,
      sourceKind: "pdf",
      fileName: "io.pdf",
      rows: draftsToRows([draft()]),
    });
    expect(body.pooling_consent).toBe(false);
    expect(body.terms_version).toBeNull();

    const consented = rowsToSaveBody({
      brandId: BRAND_A,
      sourceKind: "pdf",
      fileName: "io.pdf",
      rows: draftsToRows([draft()]),
      poolingConsent: true,
    });
    expect(consented.pooling_consent).toBe(true);
    expect(consented.terms_version).toBe(POOLING_TERMS_VERSION);
  });

  it("leaves a removed row out", () => {
    const rows = draftsToRows([
      draft({ show_name: "Dropped", rate: "nope" }),
      draft({ show_name: "Kept", raw: { keep: true } }),
    ]);
    rows[0].removed = true;

    const body = rowsToSaveBody({
      brandId: BRAND_A,
      sourceKind: "csv",
      fileName: "q1.csv",
      rows,
    });

    expect(body.records).toHaveLength(1);
    expect(body.records[0].show_name).toBe("Kept");
    expect(body.records[0].raw).toEqual({ keep: true });
  });
});

describe("catalogSuggestionLabel", () => {
  it("names one exact catalog match and stays quiet otherwise", () => {
    expect(
      catalogSuggestionLabel("acquired", [{ id: SHOW_ID, name: "Acquired" }])
    ).toBe(
      "Catalog suggestion: Acquired. The imported name stays unless you change it."
    );
    expect(
      catalogSuggestionLabel("Acquired", [
        { id: SHOW_ID, name: "Acquired" },
        { id: "other", name: "acquired" },
      ])
    ).toBe("No catalog suggestion.");
    expect(catalogSuggestionLabel("The Journal.", [])).toBe("No catalog suggestion.");
    expect(
      catalogSuggestionLabel("Acquired", [{ id: SHOW_ID, name: "Acquired" }])
    ).not.toContain(SHOW_ID);
  });
});

describe("messageFromApi", () => {
  it("returns the error string unchanged", () => {
    expect(messageFromApi({ error: "File must be under 10MB" }, "fallback")).toBe(
      "File must be under 10MB"
    );
    expect(messageFromApi({}, "Could not read this file.")).toBe(
      "Could not read this file."
    );
  });
});
