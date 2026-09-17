import { describe, it, expect } from "vitest";
import { renderLoginMagicEmail } from "./login-magic";

describe("renderLoginMagicEmail", () => {
  const out = renderLoginMagicEmail({
    login_url: "https://www.taylslate.com/callback?token_hash=abc&type=magiclink&next=/dashboard",
  });

  it("uses a specific subject, one sentence, and a Log in button", () => {
    expect(out.subject).toBe("Log in to Taylslate");
    expect(out.html).toContain("Click the button to sign in. This link expires in 24 hours.");
    expect(out.html).toMatch(/<a href="[^"]+"[^>]*>\s*Log in\s*<\/a>/);
  });

  it("is not a URL-only message — the button wraps the link", () => {
    expect(out.html).toContain(
      "https://www.taylslate.com/callback?token_hash=abc&amp;type=magiclink&amp;next=/dashboard",
    );
    expect(out.html).not.toMatch(/^https:\/\//);
    expect(out.text).toContain("Click the button to sign in.");
    expect(out.text).toContain("token_hash=abc");
  });
});
