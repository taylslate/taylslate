import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "seti_fixture_secret_do_not_log";

const { from } = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from },
}));

import { getDealSetupSecret, saveDealSetupSecret } from "./payment-secrets";

function readChain(result: unknown) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => result),
      })),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("deal payment secrets", () => {
  it("returns the stored secret", async () => {
    from.mockReturnValueOnce(
      readChain({ data: { setup_intent_client_secret: SECRET }, error: null })
    );
    await expect(getDealSetupSecret("deal_1")).resolves.toBe(SECRET);
    expect(from).toHaveBeenCalledWith("deal_payment_secrets");
  });

  it("returns null when the row is missing and does not log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    from.mockReturnValueOnce(readChain({ data: null, error: null }));
    await expect(getDealSetupSecret("deal_1")).resolves.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("upserts on deal_id", async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    from.mockReturnValueOnce({ upsert });
    await expect(saveDealSetupSecret("deal_1", SECRET)).resolves.toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        deal_id: "deal_1",
        setup_intent_client_secret: SECRET,
      }),
      { onConflict: "deal_id" }
    );
  });

  it("fails soft on a missing table and never logs the secret", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const leaked = `relation "deal_payment_secrets" does not exist (${SECRET})`;
    from.mockReturnValueOnce(readChain({ data: null, error: { message: leaked } }));
    await expect(getDealSetupSecret("deal_1")).resolves.toBeNull();

    from.mockReturnValueOnce({
      upsert: vi.fn(async () => ({ error: { message: leaked } })),
    });
    await expect(saveDealSetupSecret("deal_1", SECRET)).resolves.toBe(false);

    from.mockImplementationOnce(() => {
      throw new Error(leaked);
    });
    await expect(getDealSetupSecret("deal_1")).resolves.toBeNull();

    from.mockImplementationOnce(() => {
      throw new Error(leaked);
    });
    await expect(saveDealSetupSecret("deal_1", SECRET)).resolves.toBe(false);

    const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("[deal-payment-secrets] outcome=read_failed");
    expect(logged).toContain("[deal-payment-secrets] outcome=write_failed");
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain("does not exist");
  });
});
