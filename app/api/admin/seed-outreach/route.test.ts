import { describe, it, expect, vi, beforeEach } from "vitest";
import { TEST_ACCOUNTS } from "@/lib/admin/test-accounts";
import { verifyOutreachToken } from "@/lib/io/tokens";

const BRAND = TEST_ACCOUNTS.find((a) => a.key === "brand1")!;
const SHOW = TEST_ACCOUNTS.find((a) => a.key === "show1")!;

// One shared service-role builder. Terminal reads (maybeSingle / single) are
// driven by mockResolvedValueOnce queues in call order:
//   brand_profiles.maybeSingle -> campaigns(insert).single -> outreaches(update).single
const { adminBuilder, supabaseAdmin } = vi.hoisted(() => {
  const select = vi.fn();
  const eq = vi.fn();
  const insert = vi.fn();
  const update = vi.fn();
  const maybeSingle = vi.fn();
  const single = vi.fn();
  const b: Record<string, unknown> = {
    select: (...a: unknown[]) => (select(...a), b),
    eq: (...a: unknown[]) => (eq(...a), b),
    insert: (...a: unknown[]) => (insert(...a), b),
    update: (...a: unknown[]) => (update(...a), b),
    maybeSingle: (...a: unknown[]) => maybeSingle(...a),
    single: (...a: unknown[]) => single(...a),
  };
  const adminBuilder = { select, eq, insert, update, maybeSingle, single };
  const supabaseAdmin = { from: vi.fn(() => b) };
  return { adminBuilder, supabaseAdmin };
});

const getAuthenticatedUser = vi.fn();
const createShow = vi.fn();
const createOutreach = vi.fn();
const isInternalAdmin = vi.fn();
const logEvent = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  createShow: (...a: unknown[]) => createShow(...a),
  createOutreach: (...a: unknown[]) => createOutreach(...a),
}));
vi.mock("@/lib/auth/admin", () => ({
  isInternalAdmin: (...a: unknown[]) => isInternalAdmin(...a),
}));
vi.mock("@/lib/data/events", () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));
// NOTE: @/lib/io/tokens is intentionally NOT mocked — the token in the returned
// accept URL must verify against the real HMAC secret (dev fallback in test).

import { POST } from "./route";

function req(body?: unknown): Request {
  return new Request("http://x/api/admin/seed-outreach", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Queue one seed call's service-role terminals.
function primeServiceRole() {
  adminBuilder.maybeSingle.mockResolvedValueOnce({ data: { id: "bp1" }, error: null });
  adminBuilder.single
    .mockResolvedValueOnce({ data: { id: "camp-1" }, error: null }) // campaign insert
    .mockResolvedValueOnce({ data: { id: "outreach-1", token: "stored" }, error: null }); // token update
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUser.mockResolvedValue({ id: "u-admin", email: "chris@taylslate.com" });
  isInternalAdmin.mockReturnValue(true);
  createShow.mockResolvedValue({ id: "show-1", name: "[SEED] Catalog Feed X" });
  createOutreach.mockResolvedValue({ id: "outreach-1", show_name: "[SEED] Feed" });
  primeServiceRole();
});

describe("POST /api/admin/seed-outreach — gating", () => {
  it("rejects unauthenticated (401)", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);
    const res = await POST(req() as never);
    expect(res.status).toBe(401);
    expect(createOutreach).not.toHaveBeenCalled();
  });

  it("rejects a non-admin caller (403)", async () => {
    isInternalAdmin.mockReturnValueOnce(false);
    const res = await POST(req() as never);
    expect(res.status).toBe(403);
    expect(createOutreach).not.toHaveBeenCalled();
  });

  it("rejects an unknown variant (400)", async () => {
    const res = await POST(req({ variant: "bogus" }) as never);
    expect(res.status).toBe(400);
    expect(createOutreach).not.toHaveBeenCalled();
    expect(createShow).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/seed-outreach — catalog variant", () => {
  it("seeds a [SEED] non-discoverable catalog show + a pending outreach pointing at it", async () => {
    const res = await POST(req({ variant: "catalog" }) as never);
    expect(res.status).toBe(200);

    // Catalog show: [SEED] name, kept out of discovery, contact = onboarded show.
    expect(createShow).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringContaining("[SEED]"),
        is_discoverable: false,
        contact: expect.objectContaining({ email: SHOW.email }),
      })
    );
    // Outreach: pending, wired to the seeded brand_profile / campaign / show.
    expect(createOutreach).toHaveBeenCalledWith(
      expect.objectContaining({
        brand_profile_id: "bp1",
        campaign_id: "camp-1",
        show_id: "show-1",
        sent_to_email: SHOW.email,
        response_status: "pending",
      })
    );

    const body = await res.json();
    expect(body.variant).toBe("catalog");
    expect(body.outreachId).toBe("outreach-1");
    expect(body.seededEntityIds).toEqual({
      campaign: "camp-1",
      show: "show-1",
      outreach: "outreach-1",
    });
  });

  it("defaults to catalog when no body is sent", async () => {
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.variant).toBe("catalog");
    expect(createShow).toHaveBeenCalledTimes(1);
    expect(createOutreach).toHaveBeenCalledWith(
      expect.objectContaining({ show_id: "show-1" })
    );
  });

  it("inserts the campaign owned by the test brand with a [SEED] name", async () => {
    await POST(req({ variant: "catalog" }) as never);
    expect(adminBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: BRAND.userId,
        name: expect.stringContaining("[SEED]"),
      })
    );
  });

  it("fires the outreach.seeded marker with the catalog show id", async () => {
    await POST(req({ variant: "catalog" }) as never);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "outreach.seeded",
        entityType: "outreach",
        entityId: "outreach-1",
        actorId: "u-admin",
        payload: expect.objectContaining({
          seeded: true,
          variant: "catalog",
          outreachId: "outreach-1",
          campaignId: "camp-1",
          showId: "show-1",
        }),
      })
    );
  });
});

describe("POST /api/admin/seed-outreach — non_catalog variant", () => {
  it("seeds a pending outreach with a null show_id and a fresh chris+ alias, no show created", async () => {
    createOutreach.mockResolvedValueOnce({ id: "outreach-1", show_name: "[SEED] Materialized Feed X" });
    const res = await POST(req({ variant: "non_catalog" }) as never);
    expect(res.status).toBe(200);

    // No catalog show — the accept path materializes it later.
    expect(createShow).not.toHaveBeenCalled();

    const draft = createOutreach.mock.calls[0][0];
    expect(draft.show_id).toBeNull();
    expect(draft.response_status).toBe("pending");
    expect(draft.show_name).toContain("[SEED]");
    // A real, deliverable alias so the magic-link/onboarding leg is drivable.
    expect(draft.sent_to_email).toMatch(/^chris\+seedotr-.+@taylslate\.com$/);

    const body = await res.json();
    expect(body.variant).toBe("non_catalog");
    expect(body.seededEntityIds.show).toBeNull();
    expect(body.sentToEmail).toBe(draft.sent_to_email);
  });

  it("fires the outreach.seeded marker with a null show id", async () => {
    await POST(req({ variant: "non_catalog" }) as never);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "outreach.seeded",
        payload: expect.objectContaining({ variant: "non_catalog", showId: null }),
      })
    );
  });
});

describe("POST /api/admin/seed-outreach — accept URL token", () => {
  it("returns a public accept URL whose token verifies to the seeded outreach id", async () => {
    const res = await POST(req({ variant: "catalog" }) as never);
    const body = await res.json();

    expect(body.acceptUrl).toContain("/outreach/");
    const token = body.acceptUrl.split("/outreach/")[1];
    expect(token).toBeTruthy();

    // The real public pitch page verifies with exactly this call.
    const payload = verifyOutreachToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.outreach_id).toBe("outreach-1");
  });

  it("persists the signed token back onto the outreach row (service-role update)", async () => {
    await POST(req({ variant: "catalog" }) as never);
    // The finalize step swaps the placeholder token for the real signed one.
    const updateArg = adminBuilder.update.mock.calls[0][0] as { token: string };
    expect(verifyOutreachToken(updateArg.token)?.outreach_id).toBe("outreach-1");
  });
});
