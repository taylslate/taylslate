import { describe, expect, it, vi } from "vitest";
import { OAuthUnavailableError, oauth } from "./errors";
import { SECRET_DB } from "./test-store";

describe("oauth query guard", () => {
  it("maps a database error to unavailable and logs the code only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      oauth(Promise.resolve({ data: null, error: { code: "42P01", message: SECRET_DB } }))
    ).rejects.toBeInstanceOf(OAuthUnavailableError);
    await expect(
      oauth(Promise.resolve({ data: null, error: { code: "PGRST205", message: SECRET_DB } }))
    ).rejects.toBeInstanceOf(OAuthUnavailableError);
    const lines = warn.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(lines).toContain("42P01");
    expect(lines).toContain("PGRST205");
    expect(lines).not.toContain(SECRET_DB);
    warn.mockRestore();
  });
});
