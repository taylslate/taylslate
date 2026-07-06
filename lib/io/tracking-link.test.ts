import { describe, it, expect } from "vitest";
import { buildTrackingLink, UTM_SOURCE, UTM_MEDIUM } from "./tracking-link";

const DEAL_ID = "d4e5f6a7";

describe("buildTrackingLink", () => {
  it("returns null when brandWebsite is missing / blank", () => {
    expect(
      buildTrackingLink({ brandWebsite: null, dealId: DEAL_ID, showName: "Acquired" })
    ).toBeNull();
    expect(
      buildTrackingLink({ brandWebsite: undefined, dealId: DEAL_ID, showName: "Acquired" })
    ).toBeNull();
    expect(
      buildTrackingLink({ brandWebsite: "", dealId: DEAL_ID, showName: "Acquired" })
    ).toBeNull();
    expect(
      buildTrackingLink({ brandWebsite: "   ", dealId: DEAL_ID, showName: "Acquired" })
    ).toBeNull();
  });

  it("prepends https:// when the website has no scheme", () => {
    const link = buildTrackingLink({
      brandWebsite: "saunabox.com",
      dealId: DEAL_ID,
      showName: "Huberman Lab",
    });
    expect(link).not.toBeNull();
    const url = new URL(link!);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("saunabox.com");
  });

  it("leaves an existing scheme intact (http stays http)", () => {
    const link = buildTrackingLink({
      brandWebsite: "http://saunabox.com",
      dealId: DEAL_ID,
      showName: "Acquired",
    });
    expect(new URL(link!).protocol).toBe("http:");
  });

  it("sets the stable channel source + medium + per-show/per-deal campaign", () => {
    const link = buildTrackingLink({
      brandWebsite: "https://saunabox.com",
      dealId: DEAL_ID,
      showName: "Huberman Lab",
    });
    const params = new URL(link!).searchParams;
    expect(params.get("utm_source")).toBe(UTM_SOURCE);
    expect(params.get("utm_source")).toBe("podcast");
    expect(params.get("utm_medium")).toBe(UTM_MEDIUM);
    expect(params.get("utm_medium")).toBe("podcast");
    expect(params.get("utm_campaign")).toBe(`huberman-lab-${DEAL_ID}`);
  });

  it("falls back to the bare deal id when the show name yields no slug", () => {
    const link = buildTrackingLink({
      brandWebsite: "https://saunabox.com",
      dealId: DEAL_ID,
      showName: "!!!",
    });
    expect(new URL(link!).searchParams.get("utm_campaign")).toBe(DEAL_ID);
  });

  it("also falls back to the bare deal id when show name is null/undefined", () => {
    const nullName = buildTrackingLink({
      brandWebsite: "https://saunabox.com",
      dealId: DEAL_ID,
      showName: null,
    });
    expect(new URL(nullName!).searchParams.get("utm_campaign")).toBe(DEAL_ID);
    const noName = buildTrackingLink({ brandWebsite: "https://saunabox.com", dealId: DEAL_ID });
    expect(new URL(noName!).searchParams.get("utm_campaign")).toBe(DEAL_ID);
  });

  it("preserves existing query params and merges the utm_* keys, not clobbering", () => {
    const link = buildTrackingLink({
      brandWebsite: "https://saunabox.com/shop?ref=partner&discount=20",
      dealId: DEAL_ID,
      showName: "The Daily",
    });
    const url = new URL(link!);
    expect(url.pathname).toBe("/shop");
    // Pre-existing params survive.
    expect(url.searchParams.get("ref")).toBe("partner");
    expect(url.searchParams.get("discount")).toBe("20");
    // Our params are added.
    expect(url.searchParams.get("utm_source")).toBe("podcast");
    expect(url.searchParams.get("utm_campaign")).toBe(`the-daily-${DEAL_ID}`);
  });

  it("overwrites a pre-existing utm_* value rather than duplicating it", () => {
    const link = buildTrackingLink({
      brandWebsite: "https://saunabox.com?utm_source=oldsource",
      dealId: DEAL_ID,
      showName: "Acquired",
    });
    const sources = new URL(link!).searchParams.getAll("utm_source");
    expect(sources).toEqual(["podcast"]);
  });

  it("encodes show-name slugs and collapses internal punctuation to single hyphens", () => {
    const link = buildTrackingLink({
      brandWebsite: "https://saunabox.com",
      dealId: DEAL_ID,
      showName: "Pod Save America!",
    });
    // Spaces + trailing punctuation collapse to a clean slug; no raw spaces.
    expect(new URL(link!).searchParams.get("utm_campaign")).toBe(
      `pod-save-america-${DEAL_ID}`
    );
    expect(link).not.toContain(" ");
  });

  it("returns null for an unparseable website value", () => {
    // A bare "https://" with no host is not a valid URL.
    expect(
      buildTrackingLink({ brandWebsite: "https://", dealId: DEAL_ID, showName: "Acquired" })
    ).toBeNull();
  });

  it("rejects a non-http(s) scheme rather than emit a non-http link", () => {
    // A stored scheme that isn't http(s) must not pass through.
    expect(
      buildTrackingLink({ brandWebsite: "ftp://saunabox.com", dealId: DEAL_ID, showName: "Acquired" })
    ).toBeNull();
    // A "javascript:" value never yields an http(s) link (the https-prefixed
    // form fails to parse) — never a clickable/copyable script payload.
    expect(
      buildTrackingLink({
        brandWebsite: "javascript:alert(1)",
        dealId: DEAL_ID,
        showName: "Acquired",
      })
    ).toBeNull();
    // A "data:" URL (has "://"? no — but a scheme regardless) is rejected too.
    expect(
      buildTrackingLink({
        brandWebsite: "data://text/html,<script>alert(1)</script>",
        dealId: DEAL_ID,
        showName: "Acquired",
      })
    ).toBeNull();
  });

  it("preserves a path on the brand website", () => {
    const link = buildTrackingLink({
      brandWebsite: "saunabox.com/landing/podcast",
      dealId: DEAL_ID,
      showName: "Acquired",
    });
    expect(new URL(link!).pathname).toBe("/landing/podcast");
  });
});
