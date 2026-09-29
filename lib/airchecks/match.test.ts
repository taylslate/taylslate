import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AircheckBuy, AircheckMatchEvidence, AircheckRow, AircheckStatus } from "./types";

interface Row {
  [key: string]: unknown;
}

const { tables, resetTables } = vi.hoisted(() => {
  const tables: Record<string, Row[]> = {
    io_line_items: [],
    insertion_orders: [],
    deals: [],
    shows: [],
    brand_profiles: [],
    airchecks: [],
  };
  function resetTables() {
    for (const key of Object.keys(tables)) tables[key] = [];
  }
  return { tables, resetTables };
});

vi.mock("@/lib/supabase/admin", () => {
  function makeBuilder(table: string) {
    const filters: { col: string; val: unknown }[] = [];
    let op: "select" | "upsert" | "update" = "select";
    let payload: Row | null = null;
    let conflict: string | null = null;

    const builder = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push({ col, val });
        return builder;
      },
      upsert(row: Row, opts?: { onConflict?: string }) {
        op = "upsert";
        payload = { ...row };
        conflict = opts?.onConflict ?? null;
        return builder;
      },
      update(row: Row) {
        op = "update";
        payload = { ...row };
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(finish(false));
      },
      single() {
        return Promise.resolve(finish(true));
      },
    };

    function matches(row: Row): boolean {
      return filters.every((filter) => row[filter.col] === filter.val);
    }

    function finish(single: boolean): {
      data: Row | null;
      error: { message: string; code?: string } | null;
    } {
      const rows = tables[table] ?? [];
      if (op === "select") {
        const found = rows.filter(matches);
        if (single && found.length !== 1) {
          return { data: null, error: { message: "row count", code: "PGRST116" } };
        }
        return { data: found[0] ?? null, error: null };
      }
      if (!payload) return { data: null, error: { message: "missing payload" } };
      if (op === "update") {
        const index = rows.findIndex(matches);
        if (index < 0) {
          return { data: null, error: { message: "row count", code: "PGRST116" } };
        }
        rows[index] = {
          ...rows[index],
          ...payload,
          updated_at: new Date().toISOString(),
        };
        return { data: rows[index], error: null };
      }
      const key = conflict;
      if (key) {
        const index = rows.findIndex((row) => row[key] === payload![key]);
        if (index >= 0) {
          rows[index] = {
            ...rows[index],
            ...payload,
            updated_at: new Date().toISOString(),
          };
          return { data: rows[index], error: null };
        }
      }
      const created: Row = {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...payload,
      };
      rows.push(created);
      return { data: created, error: null };
    }

    return builder;
  }

  return {
    supabaseAdmin: {
      from(table: string) {
        return makeBuilder(table);
      },
    },
  };
});

import { aircheckIoLine, judgeAircheck } from "./match";
import { saveAircheckMatch } from "./store";

const PAD = "The host talks about supply chains and hiring. ";
const READ =
  "This episode is brought to you by Sauna Box. Head to saunabox.com and use code HUBERMAN.";
const TRANSCRIPT = PAD.repeat(30) + READ + PAD.repeat(30);
const NEITHER =
  "Today we talk about cold plunges and morning routines with no sponsor at all. ";

const BUY: AircheckBuy = {
  brandNames: ["Sauna Box"],
  promoCode: "HUBERMAN",
  url: "https://www.saunabox.com/offer",
  placement: "mid-roll",
  talkingPoints: null,
};

function row(
  status: AircheckStatus,
  transcript: string | null
): Pick<AircheckRow, "status" | "transcript_text"> {
  return { status, transcript_text: transcript };
}

function evidence(judgment: { match_evidence: AircheckMatchEvidence }): AircheckMatchEvidence {
  return judgment.match_evidence;
}

beforeEach(() => {
  resetTables();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("judgeAircheck", () => {
  it("matches when the transcript contains the brand and the code", () => {
    const judgment = judgeAircheck(row("transcribed", TRANSCRIPT), BUY);
    const found = evidence(judgment);

    expect(judgment.match_result).toBe("matched");
    expect(found.brand).toBe("found");
    expect(found.code_or_url).toBe("found");
    expect(found.position).toBe("found");
    expect(found.length).toBe("missing");
    expect(found.reason).toBeNull();
    expect(found.excerpt).toContain("Sauna Box");
    expect(found.excerpt).toContain("HUBERMAN");
  });

  it("does not match when the transcript contains neither the brand nor the code", () => {
    const judgment = judgeAircheck(row("transcribed", NEITHER.repeat(4)), {
      ...BUY,
      url: null,
    });
    const found = evidence(judgment);

    expect(judgment.match_result).toBe("not_matched");
    expect(found.brand).toBe("missing");
    expect(found.code_or_url).toBe("missing");
    expect(found.excerpt).toContain("cold plunges");
  });

  it("matches on the brand website when the IO has no promo code", () => {
    const judgment = judgeAircheck(row("transcribed", TRANSCRIPT), {
      ...BUY,
      promoCode: null,
    });
    expect(judgment.match_result).toBe("matched");
    expect(judgment.match_evidence.code_or_url).toBe("found");
  });

  it("does not match a brand mention that is missing the code and the URL", () => {
    const transcript = PAD.repeat(30) + "Thanks to Sauna Box for listening." + PAD.repeat(30);
    const judgment = judgeAircheck(row("transcribed", transcript), BUY);
    expect(judgment.match_result).toBe("not_matched");
    expect(judgment.match_evidence.brand).toBe("found");
    expect(judgment.match_evidence.code_or_url).toBe("missing");
  });

  it("skips a row with no transcript and records the reason", () => {
    const judgment = judgeAircheck(row("transcribed", "  "), BUY);
    expect(judgment.match_result).toBe("skipped");
    expect(judgment.match_evidence.reason).toBe("No transcript is stored.");
    expect(judgment.match_evidence.excerpt).toBeNull();
  });

  it("skips when status is not transcribed, even if text is present", () => {
    const judgment = judgeAircheck(row("pending", TRANSCRIPT), BUY);
    expect(judgment.match_result).toBe("skipped");
    expect(judgment.match_evidence.reason).toBe(
      "Aircheck status is pending, not transcribed."
    );
    expect(judgment.match_evidence.excerpt).toBeNull();
  });
});

describe("aircheckIoLine", () => {
  function seedTranscribed() {
    tables.io_line_items.push({
      id: "li_1",
      io_id: "io_1",
      episode_url: "https://startupstack.co/episodes/42",
      post_date: "2026-01-13",
      format: "podcast",
      placement: "mid-roll",
    });
    tables.insertion_orders.push({
      id: "io_1",
      deal_id: "deal_1",
      advertiser_name: "Sauna Box",
    });
    tables.deals.push({
      id: "deal_1",
      show_id: "show_1",
      promo_code: "HUBERMAN",
      brand_profile_id: "bp_1",
    });
    tables.brand_profiles.push({
      id: "bp_1",
      brand_name: "Sauna Box",
      brand_website: "https://saunabox.com",
    });
    tables.shows.push({ id: "show_1", rss_url: "https://feeds.example.com/show.xml" });
    tables.airchecks.push({
      id: "ac_1",
      io_line_item_id: "li_1",
      episode_identifier: "https://startupstack.co/episodes/42",
      audio_url: "https://cdn.example.com/ep42.mp3",
      transcript_text: TRANSCRIPT,
      provider: "podscan",
      status: "transcribed",
      error: null,
      match_result: null,
      match_evidence: null,
      matched_at: null,
      created_at: "2026-09-29T00:00:00.000Z",
      updated_at: "2026-09-29T00:00:00.000Z",
    });
  }

  it("stores the match on the existing row and does not call the network", async () => {
    seedTranscribed();
    const fetchMock = vi.fn(() => {
      throw new Error("network");
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await aircheckIoLine("li_1");
    const second = await aircheckIoLine("li_1");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(tables.airchecks).toHaveLength(1);
    expect(first.id).toBe("ac_1");
    expect(second.id).toBe("ac_1");
    expect(second.match_result).toBe("matched");
    expect(second.transcript_text).toBe(TRANSCRIPT);
    const stored = second.match_evidence as AircheckMatchEvidence;
    expect(stored.excerpt).toContain("Sauna Box");
    expect(stored.excerpt).toContain("HUBERMAN");
    expect(stored.brand).toBe("found");
    expect(stored.code_or_url).toBe("found");
  });

  it("stores a skip reason on the same row when there is nothing to judge", async () => {
    tables.airchecks.push({
      id: "ac_skip",
      io_line_item_id: "li_skip",
      status: "failed",
      transcript_text: null,
      error: "no audio",
    });
    const judgment = judgeAircheck(row("failed", null), BUY);
    const saved = await saveAircheckMatch("li_skip", judgment);

    expect(saved.id).toBe("ac_skip");
    expect(saved.match_result).toBe("skipped");
    expect(saved.matched_at).toBeNull();
    expect((saved.match_evidence as AircheckMatchEvidence).reason).toBe(
      "Aircheck status is failed, not transcribed."
    );
    expect(saved.transcript_text).toBeNull();
    expect(tables.airchecks).toHaveLength(1);
  });
});
