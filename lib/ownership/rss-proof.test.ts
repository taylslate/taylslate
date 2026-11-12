import { afterEach, describe, expect, it, vi } from "vitest";
import { RSS_PROOF_MAX_BYTES, RSS_PROOF_TIMEOUT_MS, readRssProofText, rssContainsCode, rssSearchText } from "./rss-proof";

const CODE = "TAYLSLATE-AB2C34";

const fetchCapped = vi.hoisted(() => vi.fn());

vi.mock("@/lib/security/safe-fetch", async () => {
  const real = await vi.importActual<typeof import("@/lib/security/safe-fetch")>("@/lib/security/safe-fetch");
  return {
    ...real,
    fetchCapped: (...args: unknown[]) => fetchCapped(...args),
  };
});

function feed(body: string): string {
  return `<?xml version="1.0"?><rss><channel>${body}</channel></rss>`;
}

describe("rss ownership text", () => {
  afterEach(() => {
    fetchCapped.mockReset();
    vi.restoreAllMocks();
  });

  it("finds the code in the channel description", () => {
    const xml = feed(`<title>Hidden Show</title><description>Welcome ${CODE}</description><item><description>nope</description></item>`);
    expect(rssContainsCode(xml, CODE.toLowerCase())).toBe(true);
    expect(rssSearchText(xml)).not.toContain("Hidden Show");
  });

  it("finds the code in episode notes from the latest 10 items", () => {
    const items = Array.from({ length: 10 }, (_, index) => {
      const notes = index === 9 ? `<content:encoded><![CDATA[<p>notes ${CODE}</p>]]></content:encoded>` : "<description>empty</description>";
      return `<item>${notes}</item>`;
    }).join("");
    expect(rssContainsCode(feed(`<description>channel</description>${items}`), CODE)).toBe(true);
  });

  it("ignores an 11th item", () => {
    const items = Array.from({ length: 10 }, () => "<item><description>empty</description></item>").join("");
    const eleventh = `<item><description>${CODE}</description><itunes:summary>${CODE}</itunes:summary></item>`;
    expect(rssContainsCode(feed(`<description>channel</description>${items}${eleventh}`), CODE)).toBe(false);
  });

  it("finds an HTML-entity-encoded code after tags are stripped", () => {
    const xml = feed(
      `<description>&lt;p&gt;TAYLSLATE&#45;AB2C34&lt;/p&gt;</description><item><itunes:summary>nope</itunes:summary></item>`
    );
    expect(rssContainsCode(xml, CODE)).toBe(true);
  });

  it("misses when the code is absent", () => {
    expect(rssContainsCode(feed("<description>hello</description><item><description>world</description></item>"), CODE)).toBe(false);
  });

  it("fetches with the rss cap and does not call the network for a blocked address", async () => {
    const real = await vi.importActual<typeof import("@/lib/security/safe-fetch")>("@/lib/security/safe-fetch");
    fetchCapped.mockImplementation(real.fetchCapped);
    const spy = vi.spyOn(globalThis, "fetch");

    const loopback = await readRssProofText("http://127.0.0.1/feed.xml");
    const privateIp = await readRssProofText("http://10.1.2.3/show.xml");
    expect(loopback).toEqual({ status: "blocked" });
    expect(privateIp).toEqual({ status: "blocked" });
    expect(spy).not.toHaveBeenCalled();

    fetchCapped.mockResolvedValue({
      ok: true,
      bytes: new TextEncoder().encode(feed(`<description>${CODE}</description>`)),
      contentType: "application/rss+xml",
    });
    const read = await readRssProofText("http://1.1.1.1/feed.xml");
    expect(read).toEqual({ status: "ok", text: CODE });
    expect(fetchCapped).toHaveBeenCalledWith(
      "http://1.1.1.1/feed.xml",
      {},
      { kind: "rss", maxBytes: RSS_PROOF_MAX_BYTES, timeoutMs: RSS_PROOF_TIMEOUT_MS }
    );
    expect(RSS_PROOF_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(RSS_PROOF_TIMEOUT_MS).toBe(10_000);
  });
});
