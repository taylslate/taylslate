import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  hashReturnToken,
  impersonationEndedEventId,
  RETURN_TOKEN_COOKIE,
} from "@/lib/admin/return-token";

// The redeem path touches domain_events twice: a SELECT to resolve the
// admin.impersonate event by payload->>return_token_hash (terminal `.limit()`),
// then an INSERT of the admin.impersonation_ended sentinel whose PK is
// deterministic — the insert's success/unique-violation IS the single-use gate.
// The builder returns a configurable lookup result for `.limit()` and a
// configurable insert result for `.insert()` (spying the inserted row).
// auth.admin's getUserById / generateLink are plain spies.
const {
  supabaseAdmin,
  getUserById,
  generateLink,
  insertSpy,
  setLookup,
  setInsertResult,
} = vi.hoisted(() => {
  let lookupResult: { data: unknown; error: unknown } = { data: [], error: null };
  let insertResult: { error: unknown } = { error: null };
  const insertSpy = vi.fn();

  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      limit: () => Promise.resolve(lookupResult),
      insert: (row: unknown) => {
        insertSpy(table, row);
        return Promise.resolve(insertResult);
      },
    };
    return b;
  }

  const getUserById = vi.fn();
  const generateLink = vi.fn();
  const supabaseAdmin = {
    from: vi.fn((t: string) => makeBuilder(t)),
    auth: { admin: { getUserById, generateLink } },
  };
  return {
    supabaseAdmin,
    getUserById,
    generateLink,
    insertSpy,
    setLookup: (r: { data: unknown; error: unknown }) => {
      lookupResult = r;
    },
    setInsertResult: (r: { error: unknown }) => {
      insertResult = r;
    },
  };
});

const isInternalAdmin = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/auth/admin", () => ({
  isInternalAdmin: (...a: unknown[]) => isInternalAdmin(...a),
}));

import { POST } from "./route";

const RAW_TOKEN = "raw-return-token-abc123";
const ADMIN_ID = "u-admin-real";
const ADMIN_EMAIL = "chris@taylslate.com";
const EVENT_ID = "evt-impersonate-1";

function req(opts: { returnToken?: string; originCookie?: string } = {}): NextRequest {
  const parts: string[] = [];
  if (opts.returnToken !== undefined) {
    parts.push(`${RETURN_TOKEN_COOKIE}=${opts.returnToken}`);
  }
  if (opts.originCookie !== undefined) {
    parts.push(`tslate_impersonation_origin=${opts.originCookie}`);
  }
  const headers: Record<string, string> = {};
  if (parts.length) headers.cookie = parts.join("; ");
  return new NextRequest("http://x/api/admin/return-to-admin", {
    method: "POST",
    headers,
  });
}

// A fresh, in-TTL impersonate event whose stored hash matches RAW_TOKEN.
function validImpersonateEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    actor_id: ADMIN_ID,
    created_at: new Date(Date.now() - 60_000).toISOString(),
    payload: {
      return_token_hash: hashReturnToken(RAW_TOKEN),
      targetEmail: "chris+brand1@taylslate.com",
      targetKey: "brand1",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setLookup({ data: [], error: null });
  setInsertResult({ error: null });
  isInternalAdmin.mockReturnValue(true);
  getUserById.mockResolvedValue({
    data: { user: { id: ADMIN_ID, email: ADMIN_EMAIL } },
    error: null,
  });
  generateLink.mockResolvedValue({
    data: { properties: { hashed_token: "hashed-abc" } },
    error: null,
  });
});

describe("POST /api/admin/return-to-admin", () => {
  it("valid token → 200 with a /callback url and writes the impersonation_ended sentinel", async () => {
    setLookup({ data: [validImpersonateEvent()], error: null });

    const res = await POST(req({ returnToken: RAW_TOKEN }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toContain("/callback?token_hash=hashed-abc");
    expect(body.url).toContain("type=magiclink");

    // Admin resolved from the event's actor_id, session minted for that email.
    expect(getUserById).toHaveBeenCalledWith(ADMIN_ID);
    expect(generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ type: "magiclink", email: ADMIN_EMAIL })
    );

    // Sentinel inserted with the deterministic PK + link back to the origin event.
    expect(insertSpy).toHaveBeenCalledWith(
      "domain_events",
      expect.objectContaining({
        id: impersonationEndedEventId(EVENT_ID),
        event_type: "admin.impersonation_ended",
        entity_id: ADMIN_ID,
        actor_id: ADMIN_ID,
        payload: expect.objectContaining({ impersonate_event_id: EVENT_ID }),
      })
    );

    // Both impersonation cookies cleared on the way back.
    expect(res.cookies.get(RETURN_TOKEN_COOKIE)?.value).toBe("");
    expect(res.cookies.get("tslate_impersonation_origin")?.value).toBe("");
  });

  it("consumes the token BEFORE minting the session (sentinel insert precedes generateLink)", async () => {
    setLookup({ data: [validImpersonateEvent()], error: null });
    const order: string[] = [];
    insertSpy.mockImplementation(() => order.push("insert"));
    generateLink.mockImplementation(() => {
      order.push("generateLink");
      return Promise.resolve({ data: { properties: { hashed_token: "h" } }, error: null });
    });

    await POST(req({ returnToken: RAW_TOKEN }));
    expect(order).toEqual(["insert", "generateLink"]);
  });

  it("absent token → 403 (nothing looked up)", async () => {
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(generateLink).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("forged token (no matching event) → 403", async () => {
    setLookup({ data: [], error: null });
    const res = await POST(req({ returnToken: "not-a-real-token" }));
    expect(res.status).toBe(403);
    expect(getUserById).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("expired token (>8h) → 403 before any admin resolution or consume", async () => {
    setLookup({
      data: [
        validImpersonateEvent({
          created_at: new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(),
        }),
      ],
      error: null,
    });
    const res = await POST(req({ returnToken: RAW_TOKEN }));
    expect(res.status).toBe(403);
    expect(getUserById).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("re-use / concurrent racer (sentinel PK unique-violation 23505) → 403, no session minted", async () => {
    setLookup({ data: [validImpersonateEvent()], error: null });
    setInsertResult({ error: { code: "23505", message: "duplicate key" } });
    const res = await POST(req({ returnToken: RAW_TOKEN }));
    expect(res.status).toBe(403);
    // Sentinel was attempted, but no session was handed out.
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("sentinel write fails (non-unique error) → 500, fails closed (no session)", async () => {
    setLookup({ data: [validImpersonateEvent()], error: null });
    setInsertResult({ error: { code: "08006", message: "connection failure" } });
    const res = await POST(req({ returnToken: RAW_TOKEN }));
    expect(res.status).toBe(500);
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("demoted admin (isInternalAdmin now false) → 403, token not consumed", async () => {
    setLookup({ data: [validImpersonateEvent()], error: null });
    isInternalAdmin.mockReturnValue(false);
    const res = await POST(req({ returnToken: RAW_TOKEN }));
    expect(res.status).toBe(403);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("ignores a tampered plaintext origin cookie — admin resolved from the event", async () => {
    setLookup({ data: [validImpersonateEvent()], error: null });
    const res = await POST(
      req({
        returnToken: RAW_TOKEN,
        originCookie: JSON.stringify({
          adminId: "attacker-id",
          adminEmail: "attacker@evil.com",
        }),
      })
    );
    expect(res.status).toBe(200);
    // The forged cookie identity is never used: lookup is by the event's
    // actor_id, and the minted session is for the real admin email.
    expect(getUserById).toHaveBeenCalledWith(ADMIN_ID);
    expect(getUserById).not.toHaveBeenCalledWith("attacker-id");
    expect(generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ email: ADMIN_EMAIL })
    );
    expect(generateLink).not.toHaveBeenCalledWith(
      expect.objectContaining({ email: "attacker@evil.com" })
    );
  });
});
