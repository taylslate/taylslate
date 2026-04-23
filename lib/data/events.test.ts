import { describe, it, expect, vi, beforeEach } from "vitest";

const { adminBuilder, supabaseAdmin } = vi.hoisted(() => {
  const builder = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn(),
    then: undefined,
  };
  return {
    adminBuilder: builder,
    supabaseAdmin: { from: vi.fn(() => builder) },
  };
});

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));

import { logEvent, listEventsForEntity } from "./events";

describe("logEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminBuilder.single.mockResolvedValue({
      data: {
        id: "e1",
        event_type: "deal.created",
        entity_type: "deal",
        entity_id: "d1",
        payload: { hello: "world" },
        schema_version: "v1",
        created_at: "2026-04-23T00:00:00Z",
      },
      error: null,
    });
  });

  it("inserts the event with default schema version v1", async () => {
    const event = await logEvent({
      eventType: "deal.created",
      entityType: "deal",
      entityId: "d1",
      payload: { hello: "world" },
    });
    expect(event?.event_type).toBe("deal.created");
    expect(adminBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "deal.created",
        entity_type: "deal",
        entity_id: "d1",
        payload: { hello: "world" },
        schema_version: "v1",
      })
    );
  });

  it("returns null but does not throw on insert failure", async () => {
    adminBuilder.single.mockResolvedValueOnce({
      data: null,
      error: { message: "boom", code: "23505" },
    });
    const event = await logEvent({
      eventType: "deal.cancelled",
      entityType: "deal",
      entityId: "d1",
      payload: {},
    });
    expect(event).toBeNull();
  });
});

describe("listEventsForEntity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries by entity_type + entity_id", async () => {
    // Make the query chain resolve to data
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{ id: "e1" }, { id: "e2" }],
        error: null,
      }),
    };
    supabaseAdmin.from.mockReturnValueOnce(chain as never);
    const events = await listEventsForEntity("deal", "d1");
    expect(events).toHaveLength(2);
    expect(chain.eq).toHaveBeenCalledWith("entity_type", "deal");
    expect(chain.eq).toHaveBeenCalledWith("entity_id", "d1");
  });
});
