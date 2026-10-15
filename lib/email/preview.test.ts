import { describe, expect, it } from "vitest";
import { EMAIL_MARK_URL, EMAIL_SITE_URL, EMAIL_WORDMARK, emailColors } from "./layout";
import { renderEmailPreviews } from "./preview";

describe("email previews", () => {
  const previews = renderEmailPreviews();

  it("renders each message on the shared layout", () => {
    expect(previews.length).toBeGreaterThanOrEqual(20);
    const ids = previews.map((preview) => preview.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const preview of previews) {
      expect(preview.html, preview.id).toContain(emailColors.paper);
      expect(preview.html, preview.id).toContain(EMAIL_WORDMARK);
      expect(preview.html, preview.id).toContain(EMAIL_MARK_URL);
      expect(preview.html, preview.id).toContain("Podcast and YouTube sponsorships");
      expect(preview.html, preview.id).toContain('data-taylslate-email="1"');
      expect(preview.text, preview.id).toContain(EMAIL_SITE_URL);
      expect(preview.subject.length, preview.id).toBeGreaterThan(0);
      expect(preview.from.length, preview.id).toBeGreaterThan(0);
    }
  });
});
