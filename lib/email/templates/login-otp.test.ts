import { describe, expect, it } from "vitest";
import { renderLoginOtpEmail } from "./login-otp";

describe("renderLoginOtpEmail", () => {
  const out = renderLoginOtpEmail({ code: "482913" });

  it("shows the code on the shared layout and does not include a magic link", () => {
    expect(out.subject).toBe("Your Taylslate sign-in code");
    expect(out.html).toContain("482913");
    expect(out.html).toContain("#ffffff");
    expect(out.html).toContain('data-taylslate-email="1"');
    expect(out.html).not.toContain("#f2ebe1");
    expect(out.html).not.toContain("token_hash=");
    expect(out.html).not.toContain("type=magiclink");
    expect(out.text).toContain("482913");
    expect(out.text).toContain("Enter this code to sign in.");
  });

  it("escapes a code that is not plain digits", () => {
    const unsafe = renderLoginOtpEmail({ code: "<b>" });
    expect(unsafe.html).toContain("&lt;b&gt;");
    expect(unsafe.html).not.toContain("<b>");
  });
});
