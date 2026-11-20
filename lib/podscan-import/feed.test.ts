import { describe, expect, it } from "vitest";
import { FEED_BYTE_CAP, extractOwnerEmail, fetchOwnerEmail, isBlockedIp } from "./feed";

function textResponse(body: string, status = 200, headers?: Record<string, string>): Response {
  return new Response(body, { status, headers });
}

const owner = (email: string) =>
  `<rss><channel><itunes:owner><itunes:email>${email}</itunes:email></itunes:owner><item><title>x</title></item></channel></rss>`;

describe("feed fetch", () => {
  it("reads the itunes owner email and decodes the five entities", () => {
    expect(extractOwnerEmail(owner("Owner&#64;sponsor.example"))).toBe("Owner@sponsor.example");
    expect(extractOwnerEmail(owner("a&amp;b@sponsor.example"))).toBe("a&b@sponsor.example");
    expect(extractOwnerEmail("<!DOCTYPE rss [<!ENTITY x 'y'>]>" + owner("a@b.co"))).toBeNull();
    expect(extractOwnerEmail("<rss><!ENTITY lol 'lol'></rss>")).toBeNull();
  });

  it("unwraps a CDATA owner email before decoding", () => {
    expect(extractOwnerEmail(owner("<![CDATA[owner@sponsor.example]]>"))).toBe("owner@sponsor.example");
    expect(extractOwnerEmail(owner("<![CDATA[ Owner&#64;sponsor.example ]]>"))).toBe("Owner@sponsor.example");
  });

  it("skips doctype, entity, file, ftp, loopback, and private hosts", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input));
      const url = String(input);
      if (url.includes("doctype")) return textResponse("<!DOCTYPE rss>" + owner("a@b.co"));
      if (url.includes("entity")) return textResponse('<rss><!ENTITY lol "lol">' + owner("a@b.co"));
      if (url.includes("redirect")) {
        const hop = Number(new URL(url).searchParams.get("hop") ?? "0");
        if (hop < 4) {
          return textResponse("", 302, { location: `https://cdn.example.test/redirect?hop=${hop + 1}` });
        }
        return textResponse(owner("late@sponsor.example"));
      }
      return textResponse(owner("owner@sponsor.example"));
    };
    const lookup = async (host: string) => {
      if (host === "loop.example.test") return ["127.0.0.1"];
      if (host === "lan.example.test") return ["10.1.2.3"];
      if (host === "link.example.test") return ["169.254.1.1"];
      if (host === "v6.example.test") return ["::1"];
      return ["1.1.1.1"];
    };
    expect((await fetchOwnerEmail("file:///etc/passwd", { fetchImpl, lookup })).skip).toBe("protocol");
    expect((await fetchOwnerEmail("ftp://files.example.test/a.xml", { fetchImpl, lookup })).skip).toBe("protocol");
    expect(calls).toEqual([]);
    expect((await fetchOwnerEmail("https://localhost/a.xml", { fetchImpl, lookup })).skip).toBe("loopback");
    expect((await fetchOwnerEmail("http://127.0.0.1/a.xml", { fetchImpl, lookup })).skip).toBe("loopback");
    expect((await fetchOwnerEmail("https://loop.example.test/a.xml", { fetchImpl, lookup })).skip).toBe("loopback");
    expect((await fetchOwnerEmail("https://v6.example.test/a.xml", { fetchImpl, lookup })).skip).toBe("loopback");
    expect((await fetchOwnerEmail("https://lan.example.test/a.xml", { fetchImpl, lookup })).skip).toBe("private");
    expect((await fetchOwnerEmail("https://link.example.test/a.xml", { fetchImpl, lookup })).skip).toBe("private");
    expect((await fetchOwnerEmail("https://feeds.example.test/doctype.xml", { fetchImpl, lookup })).skip).toBe(
      "doctype"
    );
    expect((await fetchOwnerEmail("https://feeds.example.test/entity.xml", { fetchImpl, lookup })).skip).toBe(
      "entity"
    );
    const ok = await fetchOwnerEmail("https://feeds.example.test/ok.xml", { fetchImpl, lookup });
    expect(ok.email).toBe("owner@sponsor.example");
    expect(ok.skip).toBeNull();
    const redirected = await fetchOwnerEmail("https://cdn.example.test/redirect?hop=0", { fetchImpl, lookup });
    expect(redirected.skip).toBe("redirects");
    expect(isBlockedIp("192.168.1.1")).toBe(true);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("100.64.0.1")).toBe(true);
    expect(isBlockedIp("100.127.255.255")).toBe(true);
    expect(isBlockedIp("100.63.255.255")).toBe(false);
    expect(isBlockedIp("100.128.0.1")).toBe(false);
    expect(isBlockedIp("224.0.0.1")).toBe(true);
    expect(isBlockedIp("239.255.255.255")).toBe(true);
    expect(isBlockedIp("223.255.255.255")).toBe(false);
    expect(isBlockedIp("ff02::1")).toBe(true);
    expect(isBlockedIp("ff00::")).toBe(true);
    expect(isBlockedIp("ff::1")).toBe(false);
    expect(isBlockedIp("::ffff:224.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:100.64.1.1")).toBe(true);
  });

  it("caps the body at 2MB and records a timeout", async () => {
    const huge = "x".repeat(FEED_BYTE_CAP + 32);
    const capped = await fetchOwnerEmail("https://feeds.example.test/huge.xml", {
      lookup: async () => ["1.1.1.1"],
      fetchImpl: async () => textResponse(huge),
    });
    expect(capped.skip).toBe("too_large");
    expect(capped.email).toBeNull();
    const timed = await fetchOwnerEmail("https://feeds.example.test/slow.xml", {
      lookup: async () => ["1.1.1.1"],
      fetchImpl: async () => {
        const err = new Error("timeout");
        err.name = "TimeoutError";
        throw err;
      },
    });
    expect(timed.skip).toBe("timeout");
  });
});
