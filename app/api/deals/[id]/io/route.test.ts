import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getAuthenticatedUser,
  getDealById,
  getIOByDealId,
  getNextIONumber,
  persistIoForDeal,
  createClient,
  supabaseAdmin,
  fetchSurfaceAttachment,
  isShowsAdmin,
} = vi.hoisted(() => {
  const chain = () => {
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    builder.update = vi.fn(self);
    builder.insert = vi.fn(self);
    builder.delete = vi.fn(self);
    builder.select = vi.fn(self);
    builder.eq = vi.fn(self);
    builder.not = vi.fn(self);
    builder.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve);
    return builder;
  };
  return {
    getAuthenticatedUser: vi.fn(),
    getDealById: vi.fn(),
    getIOByDealId: vi.fn(),
    getNextIONumber: vi.fn(),
    persistIoForDeal: vi.fn(),
    createClient: vi.fn(async () => ({ from: () => chain() })),
    supabaseAdmin: { from: vi.fn(() => chain()) },
    fetchSurfaceAttachment: vi.fn(),
    isShowsAdmin: vi.fn(),
  };
});

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  getDealById: (...a: unknown[]) => getDealById(...a),
  getIOByDealId: (...a: unknown[]) => getIOByDealId(...a),
  getNextIONumber: (...a: unknown[]) => getNextIONumber(...a),
}));
vi.mock("@/lib/io/persist-io", () => ({
  persistIoForDeal: (...a: unknown[]) => persistIoForDeal(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient,
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/data/show-surfaces", () => ({
  fetchSurfaceAttachment: (...a: unknown[]) => fetchSurfaceAttachment(...a),
}));
vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin: (...a: unknown[]) => isShowsAdmin(...a),
}));

import { GET, PATCH, POST } from "./route";

const SURFACE_ID = "22222222-2222-4222-8222-222222222222";

function attachment(over: { showId?: string; published?: boolean; platform?: string; name?: string } = {}) {
  const showId = over.showId ?? "show-1";
  const shows = [{ id: "show-1", name: "Oddvice", platform: "podcast" }];
  if (showId !== "show-1") {
    shows.push({
      id: showId,
      name: over.name ?? "Other Show",
      platform: over.platform ?? "podcast",
    });
  }
  return {
    ok: true as const,
    surfaces: [
      {
        id: SURFACE_ID,
        show_id: showId,
        type: "newsletter" as const,
        audience_size: 1000,
        format: null,
        min_buy: null,
        creative_constraints: null,
        lead_time_days: null,
        posting_owner: "creator" as const,
        price: 500,
        notes: null,
        published: over.published ?? true,
      },
    ],
    shows,
  };
}

const USER_ID = "user-brand";
const params = { params: Promise.resolve({ id: "deal-1" }) };

function dealOwnedBy(userId: string) {
  return {
    id: "deal-1",
    show_id: "show-1",
    brand_id: userId,
    agent_id: null,
    agency_id: null,
    docusign_envelope_id: null,
  };
}

function jsonReq(method: string, body?: object): Request {
  return new Request("http://x/api/deals/deal-1/io", {
    method,
    headers: body && method !== "GET" ? { "Content-Type": "application/json" } : undefined,
    body: body && method !== "GET" ? JSON.stringify(body) : undefined,
  });
}

const lineItem = {
  id: "11111111-1111-4111-8111-111111111111",
  format: "podcast",
  post_date: "2026-11-01",
  guaranteed_downloads: 10000,
  show_name: "Oddvice",
  placement: "mid-roll",
  is_scripted: false,
  is_personal_experience: true,
  reader_type: "host_read",
  content_type: "evergreen",
  pixel_required: false,
  gross_rate: 250,
  gross_cpm: 25,
  price_type: "cpm",
  net_due: 300,
};

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUser.mockResolvedValue({ id: USER_ID, email: "brand@taylslate.com" });
  getDealById.mockResolvedValue(dealOwnedBy(USER_ID));
  getIOByDealId.mockResolvedValue({ id: "io-1", io_number: "IO-2026-0004", line_items: [lineItem] });
  getNextIONumber.mockResolvedValue("IO-2026-0008");
  isShowsAdmin.mockResolvedValue(false);
  persistIoForDeal.mockResolvedValue({
    ioId: "io-new",
    ioNumber: "IO-2026-0008",
    created: true,
    repaired: false,
    lineItemCount: 1,
  });
});

describe("IO route party check", () => {
  it("PATCH returns 401 when nobody is signed in", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await PATCH(jsonReq("PATCH", { payment_terms: "Net 15" }) as never, params as never);
    expect(res.status).toBe(401);
    expect(getDealById).not.toHaveBeenCalled();
  });

  it("PATCH returns 404 when the deal does not exist", async () => {
    getDealById.mockResolvedValue(null);
    const res = await PATCH(jsonReq("PATCH", { payment_terms: "Net 15" }) as never, params as never);
    expect(res.status).toBe(404);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("PATCH returns 403 for a user who is not a party", async () => {
    getDealById.mockResolvedValue(dealOwnedBy("someone-else"));
    const res = await PATCH(jsonReq("PATCH", { line_items: [lineItem] }) as never, params as never);
    expect(res.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
    expect(persistIoForDeal).not.toHaveBeenCalled();
  });

  it("PATCH keeps the DocuSign lock for a party", async () => {
    getDealById.mockResolvedValue({ ...dealOwnedBy(USER_ID), docusign_envelope_id: "env-1" });
    const res = await PATCH(jsonReq("PATCH", { payment_terms: "Net 15" }) as never, params as never);
    expect(res.status).toBe(409);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("PATCH updates when the caller is the brand", async () => {
    const res = await PATCH(
      jsonReq("PATCH", { payment_terms: "Net 15", line_items: [{ ...lineItem, net_due: 300 }] }) as never,
      params as never
    );
    expect(res.status).toBe(200);
    expect(createClient).toHaveBeenCalled();
    const body = await res.json();
    expect(body.io.id).toBe("io-1");
  });

  it("POST returns 403 for a non-party and does not persist", async () => {
    getDealById.mockResolvedValue({
      ...dealOwnedBy("someone-else"),
      agent_id: "other-agent",
      agency_id: "other-agency",
    });
    const res = await POST(
      jsonReq("POST", {
        advertiser_name: "SaunaBox",
        publisher_name: "Oddvice",
        line_items: [lineItem],
      }) as never,
      params as never
    );
    expect(res.status).toBe(403);
    expect(persistIoForDeal).not.toHaveBeenCalled();
  });

  it("POST creates a draft IO for a party", async () => {
    getIOByDealId.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "io-new",
      io_number: "IO-2026-0008",
      line_items: [lineItem],
    });
    const res = await POST(
      jsonReq("POST", {
        advertiser_name: "SaunaBox",
        advertiser_contact_email: "ads@saunabox.com",
        publisher_name: "Oddvice",
        publisher_contact_name: "Host",
        publisher_contact_email: "host@show.test",
        payment_terms: "Net 30 EOM",
        line_items: [lineItem],
      }) as never,
      params as never
    );
    expect(res.status).toBe(201);
    expect(persistIoForDeal).toHaveBeenCalledWith(
      expect.objectContaining({
        dealId: "deal-1",
        actorId: USER_ID,
        source: "io_editor",
        overrides: { status: "draft" },
      })
    );
    const body = await res.json();
    expect(body.io.id).toBe("io-new");
  });

  it("POST returns 401 before looking up the deal", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await POST(jsonReq("POST", {}) as never, params as never);
    expect(res.status).toBe(401);
    expect(getDealById).not.toHaveBeenCalled();
  });

  it("GET returns 403 for a non-party and 404 when the deal is missing", async () => {
    getDealById.mockResolvedValue(null);
    const missing = await GET(jsonReq("GET", {}) as never, params as never);
    expect(missing.status).toBe(404);

    getDealById.mockResolvedValue(dealOwnedBy("someone-else"));
    const denied = await GET(jsonReq("GET", {}) as never, params as never);
    expect(denied.status).toBe(403);
    expect(getIOByDealId).not.toHaveBeenCalled();
  });

  it("GET hides the publisher email until unlock and shows it to the agent, admin, and unlocked brand", async () => {
    const stored = {
      id: "io-1",
      publisher_contact_email: "host@example.test",
      line_items: [],
    };
    getIOByDealId.mockResolvedValue(stored);
    getDealById.mockResolvedValue({
      ...dealOwnedBy(USER_ID),
      outreach_id: "outreach-1",
      status: "planning",
      show_signed_at: null,
      brand_signed_at: null,
    });
    const locked = await GET(jsonReq("GET", {}) as never, params as never);
    const lockedBody = await locked.json();
    expect(lockedBody.io.publisher_contact_email).toBe("");
    expect(lockedBody.publisher_contact_hidden).toBe(true);
    expect(JSON.stringify(lockedBody)).not.toContain("host@example.test");

    getDealById.mockResolvedValue({
      ...dealOwnedBy("brand-other"),
      agent_id: USER_ID,
      outreach_id: "outreach-1",
      status: "planning",
    });
    const agent = await (await GET(jsonReq("GET", {}) as never, params as never)).json();
    expect(agent.io.publisher_contact_email).toBe("host@example.test");
    expect(agent.publisher_contact_hidden).toBe(false);

    isShowsAdmin.mockResolvedValue(true);
    getDealById.mockResolvedValue(dealOwnedBy("someone-else"));
    const admin = await (await GET(jsonReq("GET", {}) as never, params as never)).json();
    expect(admin.io.publisher_contact_email).toBe("host@example.test");
    isShowsAdmin.mockResolvedValue(false);

    getDealById.mockResolvedValue({
      ...dealOwnedBy(USER_ID),
      outreach_id: "outreach-1",
      status: "show_signed",
      show_signed_at: "2026-11-02",
      brand_signed_at: "2026-11-01",
    });
    const unlocked = await (await GET(jsonReq("GET", {}) as never, params as never)).json();
    expect(unlocked.io.publisher_contact_email).toBe("host@example.test");
    expect(unlocked.publisher_contact_hidden).toBe(false);
  });

  it("PATCH from a brand with an empty publisher email does not change the stored value", async () => {
    const updates: unknown[] = [];
    createClient.mockResolvedValueOnce({
      from: () => {
        const builder: Record<string, unknown> = {};
        const self = () => builder;
        builder.update = vi.fn((payload: unknown) => {
          updates.push(payload);
          return builder;
        });
        builder.eq = vi.fn(self);
        builder.select = vi.fn(self);
        builder.insert = vi.fn(self);
        builder.delete = vi.fn(self);
        builder.not = vi.fn(self);
        builder.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return builder;
      },
    });
    const res = await PATCH(
      jsonReq("PATCH", { payment_terms: "Net 15", publisher_contact_email: "" }) as never,
      params as never
    );
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ payment_terms: "Net 15" });
    expect(updates[0]).not.toHaveProperty("publisher_contact_email");
  });

  function revealedIo() {
    return {
      id: "io-1",
      io_number: "IO-2026-0004",
      publisher_contact_email: "host@example.test",
      line_items: [lineItem],
    };
  }

  function capturePatch() {
    const updates: unknown[] = [];
    createClient.mockResolvedValueOnce({
      from: () => {
        const builder: Record<string, unknown> = {};
        const self = () => builder;
        builder.update = vi.fn((payload: unknown) => {
          updates.push(payload);
          return builder;
        });
        builder.eq = vi.fn(self);
        builder.select = vi.fn(self);
        builder.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return builder;
      },
    });
    return updates;
  }

  it("blanks the publisher email when a locked brand posts against an existing IO", async () => {
    getIOByDealId.mockResolvedValue(revealedIo());
    getDealById.mockResolvedValue({
      ...dealOwnedBy(USER_ID),
      outreach_id: "outreach-1",
      status: "planning",
      show_signed_at: null,
      brand_signed_at: null,
    });
    const res = await POST(
      jsonReq("POST", {
        advertiser_name: "SaunaBox",
        publisher_name: "Oddvice",
        line_items: [lineItem],
      }) as never,
      params as never
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.io.publisher_contact_email).toBe("");
    expect(body.publisher_contact_hidden).toBe(true);
    expect(JSON.stringify(body)).not.toContain("host@example.test");
    expect(persistIoForDeal).not.toHaveBeenCalled();
  });

  it("does not persist a locked brand publisher email on a new IO", async () => {
    getIOByDealId.mockResolvedValueOnce(null).mockResolvedValue(revealedIo());
    getDealById.mockResolvedValue({
      ...dealOwnedBy(USER_ID),
      outreach_id: "outreach-1",
      status: "planning",
      show_signed_at: null,
      brand_signed_at: null,
    });
    const res = await POST(
      jsonReq("POST", {
        advertiser_name: "SaunaBox",
        publisher_name: "Oddvice",
        publisher_contact_email: "planted@example.test",
        line_items: [lineItem],
      }) as never,
      params as never
    );
    expect(res.status).toBe(201);
    const saved = persistIoForDeal.mock.calls[0][0] as {
      contacts: { publisherContactEmail: string };
    };
    expect(saved.contacts.publisherContactEmail).toBe("");
    expect(JSON.stringify(persistIoForDeal.mock.calls)).not.toContain("planted@example.test");
  });

  it("blanks publisher email on POST and PATCH for a locked brand", async () => {
    getIOByDealId.mockResolvedValueOnce(null).mockResolvedValue(revealedIo());
    getDealById.mockResolvedValue({
      ...dealOwnedBy(USER_ID),
      outreach_id: "outreach-1",
      status: "planning",
      show_signed_at: null,
      brand_signed_at: null,
    });
    const posted = await POST(
      jsonReq("POST", {
        advertiser_name: "SaunaBox",
        publisher_name: "Oddvice",
        publisher_contact_email: "host@example.test",
        line_items: [lineItem],
      }) as never,
      params as never
    );
    const postedBody = await posted.json();
    expect(posted.status).toBe(201);
    expect(postedBody.io.publisher_contact_email).toBe("");
    expect(postedBody.publisher_contact_hidden).toBe(true);
    expect(JSON.stringify(postedBody)).not.toContain("host@example.test");

    const updates = capturePatch();
    const patched = await PATCH(
      jsonReq("PATCH", { payment_terms: "Net 15", publisher_contact_email: "planted@example.test" }) as never,
      params as never
    );
    const patchedBody = await patched.json();
    expect(patched.status).toBe(200);
    expect(patchedBody.io.publisher_contact_email).toBe("");
    expect(patchedBody.publisher_contact_hidden).toBe(true);
    expect(JSON.stringify(patchedBody)).not.toContain("host@example.test");
    expect(JSON.stringify(patchedBody)).not.toContain("planted@example.test");
    expect(updates[0]).toMatchObject({ payment_terms: "Net 15" });
    expect(updates[0]).not.toHaveProperty("publisher_contact_email");
  });

  it("keeps the publisher email for an agent, an admin, and an unlocked brand", async () => {
    getIOByDealId.mockResolvedValue(revealedIo());
    const cases = [
      {
        deal: { ...dealOwnedBy("brand-other"), agent_id: USER_ID },
        admin: false,
      },
      {
        deal: dealOwnedBy(USER_ID),
        admin: true,
      },
      {
        deal: {
          ...dealOwnedBy(USER_ID),
          outreach_id: "outreach-1",
          status: "show_signed",
          show_signed_at: "2026-11-02",
          brand_signed_at: "2026-11-01",
        },
        admin: false,
      },
    ];
    for (const item of cases) {
      isShowsAdmin.mockResolvedValue(item.admin);
      getDealById.mockResolvedValue(item.deal);
      const posted = await (
        await POST(
          jsonReq("POST", {
            advertiser_name: "SaunaBox",
            publisher_name: "Oddvice",
            line_items: [lineItem],
          }) as never,
          params as never
        )
      ).json();
      expect(posted.io.publisher_contact_email).toBe("host@example.test");
      expect(posted.publisher_contact_hidden).toBe(false);

      capturePatch();
      const patched = await (
        await PATCH(jsonReq("PATCH", { payment_terms: "Net 15" }) as never, params as never)
      ).json();
      expect(patched.io.publisher_contact_email).toBe("host@example.test");
      expect(patched.publisher_contact_hidden).toBe(false);
    }
    isShowsAdmin.mockResolvedValue(false);
  });

  it("does not leak a database error from a locked update", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createClient.mockResolvedValueOnce({
      from: () => {
        const builder: Record<string, unknown> = {};
        const self = () => builder;
        builder.update = vi.fn(() => builder);
        builder.eq = vi.fn(self);
        builder.select = vi.fn(self);
        builder.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data: null,
            error: { code: "42501", message: "permission denied secret host@example.test" },
          }).then(resolve);
        return builder;
      },
    });
    const res = await PATCH(jsonReq("PATCH", { payment_terms: "Net 15" }) as never, params as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to update IO");
    expect(JSON.stringify(body)).not.toContain("permission denied");
    expect(JSON.stringify(body)).not.toContain("host@example.test");
    expect(warn.mock.calls.flat().join(" ")).toContain("42501");
    expect(warn.mock.calls.flat().join(" ")).not.toContain("host@example.test");
    warn.mockRestore();
  });
});

describe("negotiated IO fields", () => {
  function captureUpdates() {
    const updates: unknown[] = [];
    createClient.mockResolvedValueOnce({
      from: () => {
        const builder: Record<string, unknown> = {};
        const self = () => builder;
        builder.update = vi.fn((payload: unknown) => {
          updates.push(payload);
          return builder;
        });
        builder.insert = vi.fn(self);
        builder.delete = vi.fn(self);
        builder.select = vi.fn(self);
        builder.eq = vi.fn(self);
        builder.not = vi.fn(self);
        builder.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve);
        return builder;
      },
    });
    return updates;
  }

  it("PATCH stores off-platform terms, the payer, and the line format", async () => {
    const updates = captureUpdates();
    const res = await PATCH(
      jsonReq("PATCH", {
        payment_terms: "Net 30 via ACH",
        payment_off_platform: true,
        rofr_enabled: false,
        make_good_enabled: true,
        download_tracking_enabled: true,
        payer: "agency",
        agency_name: "Left Field",
        line_items: [
          {
            ...lineItem,
            price_type: "flat_rate",
            placement: "pre-roll",
            spot_format: "Produced",
            gross_rate: 2500,
            net_due: 2500,
          },
        ],
      }) as never,
      params as never
    );
    expect(res.status).toBe(200);
    expect(updates[0]).toEqual(
      expect.objectContaining({
        payment_terms: "Net 30 via ACH",
        payment_off_platform: true,
        rofr_enabled: false,
        payer: "agency",
        agency_name: "Left Field",
      })
    );
    expect(updates[1]).toEqual(
      expect.objectContaining({
        price_type: "flat_rate",
        placement: "pre-roll",
        spot_format: "Produced",
        gross_rate: 2500,
        net_due: 2500,
      })
    );
  });

  it("PATCH rejects a payer other than brand or agency", async () => {
    const res = await PATCH(jsonReq("PATCH", { payer: "show" }) as never, params as never);
    expect(res.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("PATCH stores a surface id on the line and drops one that is not a uuid", async () => {
    fetchSurfaceAttachment.mockResolvedValue(attachment());
    const updates = captureUpdates();
    const surfaceId = SURFACE_ID;
    const res = await PATCH(
      jsonReq("PATCH", {
        line_items: [
          {
            ...lineItem,
            show_surface_id: surfaceId,
            spot_format: "Newsletter mention · creator posts",
            price_type: "flat_rate",
            gross_rate: 500,
            net_due: 500,
          },
        ],
      }) as never,
      params as never
    );
    expect(res.status).toBe(200);
    expect(updates[0]).toEqual(
      expect.objectContaining({
        show_surface_id: surfaceId,
        spot_format: "Newsletter mention · creator posts",
        price_type: "flat_rate",
      })
    );

    const dropped = captureUpdates();
    const bad = await PATCH(
      jsonReq("PATCH", {
        line_items: [{ ...lineItem, show_surface_id: "not-a-surface" }],
      }) as never,
      params as never
    );
    expect(bad.status).toBe(200);
    expect(dropped[0]).toEqual(expect.objectContaining({ show_surface_id: null }));
    expect(fetchSurfaceAttachment).toHaveBeenCalledTimes(1);
  });

  it("PATCH rejects a surface on another show and writes nothing", async () => {
    fetchSurfaceAttachment.mockResolvedValue(attachment({ showId: "show-2" }));
    const res = await PATCH(
      jsonReq("PATCH", {
        payment_terms: "Should not save",
        line_items: [{ ...lineItem, show_surface_id: SURFACE_ID }],
      }) as never,
      params as never
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_surface" });
    expect(createClient).not.toHaveBeenCalled();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("PATCH rejects an unpublished surface and writes nothing", async () => {
    fetchSurfaceAttachment.mockResolvedValue(attachment({ published: false }));
    const res = await PATCH(
      jsonReq("PATCH", {
        payment_terms: "Should not save",
        line_items: [{ ...lineItem, show_surface_id: SURFACE_ID }],
      }) as never,
      params as never
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_surface" });
    expect(createClient).not.toHaveBeenCalled();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("PATCH accepts a published surface on the YouTube simulcast twin", async () => {
    fetchSurfaceAttachment.mockResolvedValue(
      attachment({ showId: "show-yt", name: "Oddvice", platform: "youtube" })
    );
    const updates = captureUpdates();
    const res = await PATCH(
      jsonReq("PATCH", {
        line_items: [{ ...lineItem, show_surface_id: SURFACE_ID }],
      }) as never,
      params as never
    );
    expect(res.status).toBe(200);
    expect(updates[0]).toEqual(expect.objectContaining({ show_surface_id: SURFACE_ID }));
  });

  it("POST stores a published surface on the deal show", async () => {
    fetchSurfaceAttachment.mockResolvedValue(attachment());
    getIOByDealId.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "io-new",
      io_number: "IO-2026-0008",
      line_items: [],
    });
    const res = await POST(
      jsonReq("POST", {
        advertiser_name: "SaunaBox",
        publisher_name: "Oddvice",
        line_items: [
          {
            ...lineItem,
            show_surface_id: SURFACE_ID,
            price_type: "flat_rate",
            gross_rate: 500,
            net_due: 500,
          },
        ],
      }) as never,
      params as never
    );
    expect(res.status).toBe(201);
    const drafts = persistIoForDeal.mock.calls[0][0].rendered.lineItems;
    expect(drafts[0].show_surface_id).toBe(SURFACE_ID);
  });

  it("POST rejects a surface on another show and does not persist", async () => {
    fetchSurfaceAttachment.mockResolvedValue(attachment({ showId: "show-2" }));
    getIOByDealId.mockResolvedValueOnce(null);
    const res = await POST(
      jsonReq("POST", {
        advertiser_name: "SaunaBox",
        publisher_name: "Oddvice",
        line_items: [{ ...lineItem, show_surface_id: SURFACE_ID }],
      }) as never,
      params as never
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_surface" });
    expect(persistIoForDeal).not.toHaveBeenCalled();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("POST rejects an unpublished surface and does not persist", async () => {
    fetchSurfaceAttachment.mockResolvedValue(attachment({ published: false }));
    getIOByDealId.mockResolvedValueOnce(null);
    const res = await POST(
      jsonReq("POST", {
        advertiser_name: "SaunaBox",
        publisher_name: "Oddvice",
        line_items: [{ ...lineItem, show_surface_id: SURFACE_ID }],
      }) as never,
      params as never
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_surface" });
    expect(persistIoForDeal).not.toHaveBeenCalled();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("PATCH stores a blank spot format as null", async () => {
    const updates = captureUpdates();
    const res = await PATCH(
      jsonReq("PATCH", {
        line_items: [{ ...lineItem, spot_format: "   " }],
      }) as never,
      params as never
    );
    expect(res.status).toBe(200);
    expect(updates[0]).toEqual(expect.objectContaining({ spot_format: null }));
  });
});
