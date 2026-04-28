import { describe, it, expect, vi, beforeEach } from "vitest";

const { adminBuilder, supabaseAdmin } = vi.hoisted(() => {
  const builder = {
    insert: vi.fn(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
  };
  return {
    adminBuilder: builder,
    supabaseAdmin: { from: vi.fn(() => builder) },
  };
});

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));

import { recordEvent, listEventsForCustomer } from "./event-log";

describe("recordEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminBuilder.insert.mockResolvedValue({ data: null, error: null });
  });

  it("inserts the row with the right shape", async () => {
    await recordEvent({
      customerId: "u1",
      operationType: "outreach_sent",
      metadata: { outreach_id: "o1", show_id: "s1" },
    });
    expect(supabaseAdmin.from).toHaveBeenCalledWith("event_log");
    expect(adminBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: "u1",
        operation_type: "outreach_sent",
        metadata: { outreach_id: "o1", show_id: "s1" },
      })
    );
  });

  it("defaults metadata to {} when omitted", async () => {
    await recordEvent({
      customerId: "u1",
      operationType: "campaign_generated",
    });
    expect(adminBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: {} })
    );
  });

  it("skips silently when customerId is null/undefined (no insert)", async () => {
    await recordEvent({
      customerId: null,
      operationType: "io_generated",
    });
    await recordEvent({
      customerId: undefined,
      operationType: "io_generated",
    });
    expect(adminBuilder.insert).not.toHaveBeenCalled();
  });

  it("never throws when the Supabase call returns an error", async () => {
    adminBuilder.insert.mockResolvedValueOnce({
      data: null,
      error: { message: "boom", code: "X" },
    });
    await expect(
      recordEvent({ customerId: "u1", operationType: "discovery_run" })
    ).resolves.toBeUndefined();
  });

  it("never throws when the Supabase call itself throws", async () => {
    adminBuilder.insert.mockImplementationOnce(() => {
      throw new Error("network down");
    });
    await expect(
      recordEvent({ customerId: "u1", operationType: "discovery_run" })
    ).resolves.toBeUndefined();
  });
});

describe("listEventsForCustomer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters by customer + operationType + sinceIso when provided", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      gte: vi.fn().mockResolvedValue({
        data: [{ id: "e1" }, { id: "e2" }],
        error: null,
      }),
    };
    supabaseAdmin.from.mockReturnValueOnce(chain as never);

    const rows = await listEventsForCustomer("u1", {
      operationType: "conversion_alert_sent",
      sinceIso: "2026-04-21T00:00:00Z",
    });
    expect(rows).toHaveLength(2);
    expect(chain.eq).toHaveBeenCalledWith("customer_id", "u1");
    expect(chain.eq).toHaveBeenCalledWith(
      "operation_type",
      "conversion_alert_sent"
    );
    expect(chain.gte).toHaveBeenCalledWith(
      "timestamp",
      "2026-04-21T00:00:00Z"
    );
  });
});
