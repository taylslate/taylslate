import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const { getAuthenticatedUser, enforceRosterDispute, sendEmail, adminFrom, db } = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  enforceRosterDispute: vi.fn(),
  sendEmail: vi.fn(),
  adminFrom: vi.fn(),
  db: {
    links: [] as Row[],
    proofs: [] as Row[],
    profiles: [] as Row[],
    disputes: [] as Row[],
  },
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
}));
vi.mock("@/lib/security/rate-limit", () => ({
  enforceRosterDispute: (...args: unknown[]) => enforceRosterDispute(...args),
}));
vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => adminFrom(...args) },
}));

import { NextResponse } from "next/server";
import { POST } from "./route";

const LINK = "11111111-1111-4111-8111-111111111111";
const MISSING = "99999999-9999-4999-8999-999999999999";
const SHOW = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const AGENT = "44444444-4444-4444-8444-444444444444";
const NOT_FOUND = { error: "Not found" };

function installAdmin() {
  adminFrom.mockImplementation((table: string) => {
    const filters: { column: string; value: unknown }[] = [];
    let insertRow: Row | null = null;
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    builder.select = vi.fn(self);
    builder.eq = vi.fn((column: string, value: unknown) => {
      filters.push({ column, value });
      return builder;
    });
    builder.limit = vi.fn(self);
    builder.insert = vi.fn((row: Row) => {
      insertRow = row;
      return builder;
    });
    const matches = (row: Row) => filters.every((filter) => row[filter.column] === filter.value);
    const run = () => {
      if (insertRow) {
        const duplicate = db.disputes.some(
          (row) => row.link_id === insertRow?.link_id && row.owner_user_id === insertRow?.owner_user_id
        );
        if (duplicate) return { data: null, error: { code: "23505", message: "duplicate key" } };
        const stored = { id: `dispute-${db.disputes.length + 1}`, ...insertRow };
        db.disputes.push(stored);
        return { data: { id: stored.id }, error: null };
      }
      if (table === "agent_show_relationships") return { data: db.links.filter(matches), error: null };
      if (table === "show_ownership_proofs") return { data: db.proofs.filter(matches), error: null };
      if (table === "profiles") return { data: db.profiles.filter(matches), error: null };
      return { data: [], error: null };
    };
    builder.maybeSingle = vi.fn(async () => {
      const result = run();
      const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
      return { data, error: result.error };
    });
    builder.then = (
      resolve: (value: { data: unknown; error: { code?: string } | null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(run()).then(resolve, reject);
    return builder;
  });
}

function post(id: string, body?: unknown) {
  return POST(
    new Request(`http://x/api/roster-links/${id}/dispute`, {
      method: "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  getAuthenticatedUser.mockReset();
  enforceRosterDispute.mockReset();
  sendEmail.mockReset();
  adminFrom.mockReset();
  db.links = [
    {
      id: LINK,
      show_id: SHOW,
      agent_id: AGENT,
      status: "pending",
      shows: { name: "Odd Lots", ownership_status: "verified" },
    },
  ];
  db.proofs = [{ show_id: SHOW, user_id: OWNER, status: "verified" }];
  db.profiles = [{ id: AGENT, company_name: "Northwind", full_name: "Ada", email: "rep-secret@example.com" }];
  db.disputes = [];
  installAdmin();
  enforceRosterDispute.mockResolvedValue(null);
  sendEmail.mockResolvedValue({ ok: true, id: "mail-1" });
  process.env.INTERNAL_ALERT_EMAIL = "alerts@example.com";
  getAuthenticatedUser.mockResolvedValue({ id: OWNER, email: "owner@example.com" });
});

describe("POST /api/roster-links/[id]/dispute", () => {
  it("returns 401 when nobody is signed in", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const response = await post(LINK, {});
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(enforceRosterDispute).not.toHaveBeenCalled();
    expect(db.disputes).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns the same 404 for a missing link and a non-owner", async () => {
    const missing = await post(MISSING, {});
    getAuthenticatedUser.mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      email: "other@example.com",
    });
    const nonOwner = await post(LINK, {});
    expect(missing.status).toBe(404);
    expect(nonOwner.status).toBe(404);
    expect(await missing.json()).toEqual(NOT_FOUND);
    expect(await nonOwner.json()).toEqual(NOT_FOUND);
    expect(db.disputes).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns 429 before an insert", async () => {
    enforceRosterDispute.mockResolvedValue(
      NextResponse.json(
        { error: "Too many requests. Try again later." },
        { status: 429, headers: { "Retry-After": "3600" } }
      )
    );
    const response = await post(LINK, { note: "Hello" });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect(db.disputes).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("flags once, emails the admin once, and does not email again", async () => {
    const first = await post(LINK, { note: "  <b>Not mine</b>  " });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, result: "flagged" });
    expect(db.disputes).toHaveLength(1);
    expect(db.disputes[0]).toMatchObject({
      link_id: LINK,
      show_id: SHOW,
      owner_user_id: OWNER,
      note: "<b>Not mine</b>",
      status: "open",
    });
    expect(db.links[0].status).toBe("pending");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0] as { to: string; html: string; text: string; from?: string };
    expect(mail.to).toBe("alerts@example.com");
    expect(mail.from).toBeUndefined();
    expect(mail.html).toContain("owner@example.com");
    expect(mail.html).toContain("Northwind");
    expect(mail.html).toContain("Odd Lots");
    expect(mail.html).toContain("&lt;b&gt;");
    expect(mail.html).not.toContain("<b>");
    expect(mail.text).toContain("<b>Not mine</b>");

    const second = await post(LINK, { note: "Again" });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, result: "already flagged" });
    expect(db.disputes).toHaveLength(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("returns already declined for a rejected link and writes nothing", async () => {
    db.links[0].status = "rejected";
    const response = await post(LINK, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: "already declined" });
    expect(db.disputes).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects a 501 character note before any insert or send", async () => {
    const response = await post(LINK, { note: "a".repeat(501) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A note can be at most 500 characters." });
    expect(db.disputes).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("keeps a flagged response when send fails or throws", async () => {
    sendEmail.mockResolvedValueOnce({ ok: false, reason: "no_api_key" });
    const failed = await post(LINK, { note: "SECRET-NOTE" });
    expect(failed.status).toBe(200);
    expect(await failed.json()).toEqual({ ok: true, result: "flagged" });

    db.disputes = [];
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    sendEmail.mockRejectedValueOnce(new Error("boom owner@example.com SECRET-NOTE"));
    const thrown = await post(LINK, { note: "SECRET-NOTE" });
    expect(thrown.status).toBe(200);
    expect(await thrown.json()).toEqual({ ok: true, result: "flagged" });
    const logged = errors.flat().map(String).join(" ");
    expect(logged).not.toContain("owner@example.com");
    expect(logged).not.toContain("SECRET-NOTE");
    spy.mockRestore();
  });
});
