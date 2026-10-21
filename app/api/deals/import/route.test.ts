import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IO_EXTRACTION_SYSTEM_PROMPT } from "@/lib/prompts/io-extraction";
import { getLLMModel } from "@/lib/llm/client";

const { mockCreate, ctorState, getAuthenticatedUser, getUserProfile, createLLMClient } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  ctorState: { throwOnConstruct: false },
  getAuthenticatedUser: vi.fn(),
  getUserProfile: vi.fn(),
  createLLMClient: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    constructor() {
      if (ctorState.throwOnConstruct) {
        throw new Error("Could not resolve authentication method");
      }
    }
    messages = { create: mockCreate };
  },
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
  getUserProfile: (...args: unknown[]) => getUserProfile(...args),
}));

vi.mock("@/lib/llm/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/llm/client")>("@/lib/llm/client");
  return {
    ...actual,
    createLLMClient: (...args: unknown[]) => createLLMClient(...args),
  };
});

import { POST } from "./route";

const FIXTURE = path.join(process.cwd(), "lib/imports/fixtures");
const USER_ID = "11111111-1111-4111-8111-111111111111";

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
  ],
};

function textMessage(text: string) {
  return { stop_reason: "end_turn", content: [{ type: "text", text }] };
}

function upload(name: string, type: string, bytes: Uint8Array, mode?: string, url?: string) {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const form = new FormData();
  form.append("file", new File([copy], name, { type }));
  if (mode) form.append("mode", mode);
  return new Request(url ?? "http://localhost/api/deals/import", {
    method: "POST",
    body: form,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  mockCreate.mockReset();
  ctorState.throwOnConstruct = false;
  getAuthenticatedUser.mockReset();
  getUserProfile.mockReset();
  createLLMClient.mockReset();
  getAuthenticatedUser.mockResolvedValue({ id: USER_ID, email: "brand@taylslate.com" });
  getUserProfile.mockResolvedValue({ id: USER_ID, role: "brand", email: "brand@taylslate.com" });
  createLLMClient.mockImplementation(() => {
    if (ctorState.throwOnConstruct) {
      throw new Error("Could not resolve authentication method");
    }
    return { messages: { create: mockCreate } };
  });
  vi.stubEnv("LLM_MODEL", "claude-test-model");
  mockCreate.mockImplementation(async (params: { messages: { content: unknown }[] }) => {
    const content = params.messages[0]?.content;
    if (typeof content === "string") return textMessage(JSON.stringify(COLUMN_MAP));
    return textMessage(JSON.stringify(IO));
  });
});

describe("POST /api/deals/import existing paths", () => {
  it("keeps the IO PDF model and response shape", async () => {
    const bytes = new Uint8Array(readFileSync(path.join(FIXTURE, "past-campaign.pdf")));
    const res = await POST(upload("io.pdf", "application/pdf", bytes) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("pdf");
    expect(body.io.advertiser_name).toBe("SaunaBox");
    expect(body.io.line_items[0].show_name).toBe("Acquired");
    expect(body.validation.valid).toBe(true);
    expect(body.drafts).toBeUndefined();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [payload, options] = mockCreate.mock.calls[0];
    expect(payload.model).toBe("claude-sonnet-4-20250514");
    expect(payload.system).toBe(IO_EXTRACTION_SYSTEM_PROMPT);
    expect(payload.messages[0].content[0].type).toBe("document");
    expect(options).toBeUndefined();
    expect(getAuthenticatedUser).not.toHaveBeenCalled();
    expect(createLLMClient).not.toHaveBeenCalled();
  });

  it("keeps manual JSON entry off the model", async () => {
    const res = await POST(
      new Request("http://localhost/api/deals/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...IO, mode: "past_campaign" }),
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("manual");
    expect(body.io.advertiser_name).toBe("SaunaBox");
    expect(body.drafts).toBeUndefined();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(getAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("still rejects a non-pdf upload and an unknown content type", async () => {
    const csv = new Uint8Array(readFileSync(path.join(FIXTURE, "past-campaign.csv")));
    const rejected = await POST(upload("history.csv", "text/csv", csv) as never);
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toMatch(/Only PDF/);

    const plain = await POST(
      new Request("http://localhost/api/deals/import", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "hello",
      }) as never
    );
    expect(plain.status).toBe(415);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(getAuthenticatedUser).not.toHaveBeenCalled();
  });
});

describe("POST /api/deals/import mode=past_campaign", () => {
  it("returns csv drafts and maps columns with the shared LLM client", async () => {
    const csv = new Uint8Array(readFileSync(path.join(FIXTURE, "past-campaign.csv")));
    const res = await POST(upload("past-campaign.csv", "text/csv", csv, "past_campaign") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("past_campaign");
    expect(body.source_kind).toBe("csv");
    expect(body.io).toBeUndefined();
    expect(body.drafts[0].show_name).toBe("Acquired");
    expect(body.drafts[0].raw["Total Spend"]).toBe("$2,250");
    expect(body.drafts[1].show_name).toBe("Odd Lots, Bloomberg");

    const [payload, options] = mockCreate.mock.calls[0];
    expect(payload.model).toBe(getLLMModel());
    expect(payload.model).toBe("claude-test-model");
    expect(payload.model).not.toBe("claude-sonnet-4-20250514");
    expect(typeof payload.messages[0].content).toBe("string");
    expect(options).toEqual({ maxRetries: 0 });
  });

  it("accepts mode from the query string", async () => {
    const csv = new Uint8Array(readFileSync(path.join(FIXTURE, "past-campaign.csv")));
    const res = await POST(
      upload(
        "past-campaign.csv",
        "text/csv",
        csv,
        undefined,
        "http://localhost/api/deals/import?mode=past_campaign"
      ) as never
    );
    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe("past_campaign");
  });

  it("returns pdf drafts with the existing IO model", async () => {
    const bytes = new Uint8Array(readFileSync(path.join(FIXTURE, "past-campaign.pdf")));
    const res = await POST(upload("past-campaign.pdf", "application/pdf", bytes, "past_campaign") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("past_campaign");
    expect(body.source_kind).toBe("pdf");
    expect(body.io).toBeUndefined();
    expect(body.drafts[0]).toMatchObject({
      show_name: "Acquired",
      price_type: "cpm",
      rate: 25,
      episodes: 1,
      spend: 250,
      matched_show_id: null,
    });
    expect(createLLMClient).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0].model).toBe("claude-sonnet-4-20250514");
    expect(mockCreate.mock.calls[0][0].messages[0].content[0].type).toBe("document");
    expect(mockCreate.mock.calls[0][1]).toBeUndefined();
  });

  it("requires a signed-in brand or agency", async () => {
    const csv = new Uint8Array(readFileSync(path.join(FIXTURE, "past-campaign.csv")));

    getAuthenticatedUser.mockResolvedValue(null);
    const signedOut = await POST(upload("past-campaign.csv", "text/csv", csv, "past_campaign") as never);
    expect(signedOut.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();

    getAuthenticatedUser.mockResolvedValue({ id: USER_ID, email: "show@taylslate.com" });
    getUserProfile.mockResolvedValue({ id: USER_ID, role: "show" });
    const show = await POST(upload("past-campaign.csv", "text/csv", csv, "past_campaign") as never);
    expect(show.status).toBe(403);

    getUserProfile.mockResolvedValue({ id: USER_ID, role: "agent" });
    const agent = await POST(upload("past-campaign.csv", "text/csv", csv, "past_campaign") as never);
    expect(agent.status).toBe(403);

    getUserProfile.mockResolvedValue(null);
    const missing = await POST(upload("past-campaign.csv", "text/csv", csv, "past_campaign") as never);
    expect(missing.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("allows an agency account to parse", async () => {
    getUserProfile.mockResolvedValue({ id: USER_ID, role: "agency", email: "agency@taylslate.com" });
    const csv = new Uint8Array(readFileSync(path.join(FIXTURE, "past-campaign.csv")));
    const res = await POST(upload("past-campaign.csv", "text/csv", csv, "past_campaign") as never);
    expect(res.status).toBe(200);
    expect((await res.json()).drafts[0].show_name).toBe("Acquired");
  });

  it("rejects an oversized file, a mime mismatch, and too many rows", async () => {
    const oversized = await POST(
      upload("big.csv", "text/csv", new Uint8Array(10 * 1024 * 1024 + 1), "past_campaign") as never
    );
    expect(oversized.status).toBe(400);
    expect((await oversized.json()).error).toMatch(/10MB/);

    const mismatch = await POST(
      upload("history.csv", "application/pdf", new Uint8Array([1, 2, 3]), "past_campaign") as never
    );
    expect(mismatch.status).toBe(400);
    expect((await mismatch.json()).error).toMatch(/does not match/);

    const lines = ["Show", ...Array.from({ length: 2001 }, (_, i) => `Show ${i}`)];
    const tooMany = await POST(
      upload("many.csv", "text/csv", new TextEncoder().encode(lines.join("\n")), "past_campaign") as never
    );
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json()).error).toMatch(/2,000/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("reports a missing API key for pdf extraction", async () => {
    ctorState.throwOnConstruct = true;
    const bytes = new Uint8Array(readFileSync(path.join(FIXTURE, "past-campaign.pdf")));
    const res = await POST(upload("past-campaign.pdf", "application/pdf", bytes, "past_campaign") as never);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("NO_API_KEY");
  });
});
