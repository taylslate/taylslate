import { describe, expect, it } from "vitest";
import {
  EMAIL_MARK_URL,
  EMAIL_SITE_URL,
  EMAIL_WORDMARK,
  emailColors,
  escapeHtml,
  renderEmailLayout,
} from "./layout";

describe("renderEmailLayout", () => {
  const year = new Date().getFullYear();
  const laid = renderEmailLayout({
    preheader: "Preview line",
    headline: "Headline",
    bodyHtml: "<p>Body</p>",
    cta: {
      href: "https://www.taylslate.com/callback?token_hash=abc&type=magiclink",
      label: "Log in",
    },
    note: "A short note.",
    text: "Plain body\n\nhttps://www.taylslate.com/callback?token_hash=abc&type=magiclink",
  });

  it("uses the paper field, wordmark, mark, and footer", () => {
    expect(laid.html).toContain(`background:${emailColors.paper}`);
    expect(laid.html).toContain(EMAIL_WORDMARK);
    expect(laid.html).toContain(EMAIL_MARK_URL);
    expect(laid.html).toContain('data-taylslate-email="1"');
    expect(laid.html).toContain("Podcast and YouTube sponsorships");
    expect(laid.html).toContain(`© ${year} Taylslate`);
    expect(laid.html).toContain(emailColors.ink);
    expect(laid.html).toContain("border-radius:4px");
  });

  it("escapes the button href and keeps the raw URL in the text part", () => {
    expect(laid.html).toContain("token_hash=abc&amp;type=magiclink");
    expect(laid.html).toContain(">Log in</a>");
    expect(laid.text).toContain("token_hash=abc&type=magiclink");
    expect(laid.text).toContain(EMAIL_SITE_URL);
    expect(laid.text).toContain(`© ${year} Taylslate`);
  });

  it("escapes HTML in caller-supplied plain fields", () => {
    expect(escapeHtml(`a <b> & "c"`)).toBe("a &lt;b&gt; &amp; &quot;c&quot;");
    const unsafe = renderEmailLayout({
      preheader: "<script>",
      headline: "A & B",
      bodyHtml: "<p>trusted</p>",
      text: "ok",
    });
    expect(unsafe.html).toContain("&lt;script&gt;");
    expect(unsafe.html).toContain("A &amp; B");
    expect(unsafe.html).toContain("<p>trusted</p>");
  });
});
