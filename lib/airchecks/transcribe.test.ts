import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchRssItem, parseRssItems } from "./rss";

interface Row {
  [key: string]: unknown;
}

const { tables, resetTables } = vi.hoisted(() => {
  const tables: Record<string, Row[]> = {
    io_line_items: [],
    insertion_orders: [],
    deals: [],
    shows: [],
    airchecks: [],
  };
  function resetTables() {
    for (const key of Object.keys(tables)) tables[key] = [];
  }
  return { tables, resetTables };
});

vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "1.1.1.1", family: 4 }],
}));

vi.mock("@/lib/supabase/admin", () => {
  function makeBuilder(table: string) {
    const filters: { col: string; val: unknown }[] = [];
    let op: "select" | "upsert" = "select";
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
      maybeSingle() {
        return Promise.resolve(finish(false));
      },
      single() {
        return Promise.resolve(finish(true));
      },
    };

    function finish(single: boolean): { data: Row | null; error: { message: string; code?: string } | null } {
      const rows = tables[table] ?? [];
      if (op === "select") {
        const found = rows.filter((row) =>
          filters.every((filter) => row[filter.col] === filter.val)
        );
        if (single && found.length !== 1) {
          return { data: null, error: { message: "row count", code: "PGRST116" } };
        }
        return { data: found[0] ?? null, error: null };
      }
      if (!payload) return { data: null, error: { message: "missing payload" } };
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

import { AircheckLineNotFound, transcribeIoLine } from "./transcribe";

const RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Other</title>
      <link>https://startupstack.co/episodes/41</link>
      <guid>https://startupstack.co/episodes/41</guid>
      <pubDate>Mon, 06 Jan 2026 12:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/ep41.mp3" type="audio/mpeg" length="1"/>
    </item>
    <item>
      <title>Forty Two</title>
      <link>https://startupstack.co/episodes/42</link>
      <guid isPermaLink="true">https://startupstack.co/episodes/42</guid>
      <pubDate>Tue, 13 Jan 2026 12:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/ep42.mp3" length="2" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`;

function seedLine() {
  tables.io_line_items.push({
    id: "li_1",
    io_id: "io_1",
    episode_url: "https://startupstack.co/episodes/42",
    post_date: "2026-01-13",
    format: "podcast",
  });
  tables.insertion_orders.push({ id: "io_1", deal_id: "deal_1" });
  tables.deals.push({ id: "deal_1", show_id: "show_1" });
  tables.shows.push({
    id: "show_1",
    rss_url: "https://feeds.example.com/show.xml",
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function mockNetwork(
  podscanBody: unknown,
  extra?: (url: string, init?: RequestInit) => Response | null
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const handled = extra?.(url, init);
    if (handled) return handled;
    if (url.includes("podscan.fm")) {
      return new Response(JSON.stringify(podscanBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("feeds.example.com")) {
      return new Response(RSS, {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      });
    }
    return new Response(`unexpected ${url}`, { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  resetTables();
  process.env.PODSCAN_API_KEY = "test-key";
  delete process.env.AIRCHECK_TRANSCRIPTION_PROVIDER;
  delete process.env.AIRCHECK_TRANSCRIPTION_URL;
  delete process.env.AIRCHECK_TRANSCRIPTION_API_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RSS item match", () => {
  const items = parseRssItems(RSS);

  it("matches the line's episode URL to that item's enclosure", () => {
    const item = matchRssItem(items, "https://www.startupstack.co/episodes/42/", null);
    expect(item?.enclosureUrl).toBe("https://cdn.example.com/ep42.mp3");
  });

  it("uses the post date only when the line has no episode URL", () => {
    const item = matchRssItem(items, null, "2026-01-13");
    expect(item?.enclosureUrl).toBe("https://cdn.example.com/ep42.mp3");
    expect(matchRssItem(items, "https://startupstack.co/missing", "2026-01-13")).toBeNull();
  });
});

describe("transcribeIoLine", () => {
  it("stores the Podscan transcript for the RSS enclosure", async () => {
    seedLine();
    const fetchMock = mockNetwork({
      episodes: [
        {
          transcription: "Host read the mid-roll for the brand.",
          episode_audio_url: "https://cdn.example.com/ep42.mp3",
          episode_guid: "https://startupstack.co/episodes/42",
        },
      ],
    });

    const row = await transcribeIoLine("li_1");

    expect(row.status).toBe("transcribed");
    expect(row.transcript_text).toBe("Host read the mid-roll for the brand.");
    expect(row.provider).toBe("podscan");
    expect(row.audio_url).toBe("https://cdn.example.com/ep42.mp3");
    expect(row.episode_identifier).toBe("https://startupstack.co/episodes/42");
    expect(row.error).toBeNull();
    expect(tables.airchecks).toHaveLength(1);
    const podscanCall = fetchMock.mock.calls
      .map((call) => requestUrl(call[0]))
      .find((url) => url.includes("podscan.fm"));
    expect(podscanCall).toContain("enclosure_url=");
    expect(decodeURIComponent(podscanCall ?? "")).toContain(
      "https://cdn.example.com/ep42.mp3"
    );
  });

  it("stores status failed and does not throw when no transcript is available", async () => {
    seedLine();
    mockNetwork({ episodes: [] });

    const row = await transcribeIoLine("li_1");

    expect(row.status).toBe("failed");
    expect(row.transcript_text).toBeNull();
    expect(row.error).toMatch(/AIRCHECK_TRANSCRIPTION_PROVIDER is off/);
    expect(row.audio_url).toBe("https://cdn.example.com/ep42.mp3");
    expect(tables.airchecks).toHaveLength(1);

    const again = await transcribeIoLine("li_1");
    expect(again.id).toBe(row.id);
    expect(again.status).toBe("failed");
    expect(tables.airchecks).toHaveLength(1);
  });

  it("does not insert a second row when the line is already transcribed", async () => {
    seedLine();
    const fetchMock = mockNetwork({
      episodes: [{ transcription: "The read is in the episode." }],
    });

    const first = await transcribeIoLine("li_1");
    const callsAfterFirst = fetchMock.mock.calls.length;
    const second = await transcribeIoLine("li_1");

    expect(second.id).toBe(first.id);
    expect(second.transcript_text).toBe("The read is in the episode.");
    expect(tables.airchecks).toHaveLength(1);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("records the fallback provider when Podscan has no transcript", async () => {
    seedLine();
    process.env.AIRCHECK_TRANSCRIPTION_PROVIDER = "whisper";
    process.env.AIRCHECK_TRANSCRIPTION_URL =
      "https://transcribe.example.com/v1/audio/transcriptions";
    process.env.AIRCHECK_TRANSCRIPTION_API_KEY = "test-whisper";
    const fetchMock = mockNetwork({ episodes: [] }, (url, init) => {
      if (url.includes("cdn.example.com/ep42.mp3")) {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      }
      if (url.includes("transcribe.example.com")) {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer test-whisper",
        });
        return new Response(JSON.stringify({ text: "Whisper transcript of the read." }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return null;
    });

    const row = await transcribeIoLine("li_1");

    expect(row.status).toBe("transcribed");
    expect(row.provider).toBe("whisper");
    expect(row.transcript_text).toBe("Whisper transcript of the read.");
    expect(tables.airchecks).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("throws when the IO line does not exist and writes no row", async () => {
    mockNetwork({ episodes: [] });
    await expect(transcribeIoLine("missing")).rejects.toBeInstanceOf(
      AircheckLineNotFound
    );
    expect(tables.airchecks).toHaveLength(0);
  });
});
