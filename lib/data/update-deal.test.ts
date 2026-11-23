import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => from(...args) },
}));
vi.mock("@/lib/data/events", () => ({ logEvent: vi.fn() }));

import { updateDeal } from "@/lib/data/queries";

beforeEach(() => {
  from.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("updateDeal", () => {
  it("writes an allowed note", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "deal-1", notes: "Hi" }, error: null });
    const eq = vi.fn(() => ({ select: () => ({ single }) }));
    const update = vi.fn(() => ({ eq }));
    from.mockReturnValue({ update });
    const saved = await updateDeal("deal-1", { notes: "Hi" });
    expect(saved).toMatchObject({ id: "deal-1" });
    expect(update).toHaveBeenCalledWith({ notes: "Hi" });
  });

  it("refuses a money field before any write", async () => {
    const saved = await updateDeal("deal-1", { notes: "Hi", agreed_cpm: 12 } as never);
    expect(saved).toBeNull();
    expect(from).not.toHaveBeenCalled();
    const logged = vi.mocked(console.error).mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).not.toMatch(/agreed_cpm|deal-1/);
  });
});
