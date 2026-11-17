import { describe, expect, it } from "vitest";
import { checkEmails, checkSyntax, contactStatus, emailStatus, lookupMx, type DnsLike } from "./email";

function dns(over: Partial<DnsLike> & { calls?: string[] }): DnsLike {
  const calls = over.calls ?? [];
  return {
    resolveMx: async (domain) => {
      calls.push(`mx:${domain}`);
      if (over.resolveMx) return over.resolveMx(domain);
      return [{ exchange: "mx.example.net", priority: 1 }];
    },
    resolve4: async (domain) => {
      calls.push(`a:${domain}`);
      if (over.resolve4) return over.resolve4(domain);
      return ["1.1.1.1"];
    },
    resolve6: async (domain) => {
      calls.push(`aaaa:${domain}`);
      if (over.resolve6) return over.resolve6(domain);
      return ["2606:4700:4700::1111"];
    },
  };
}

describe("email checks", () => {
  it("checks syntax and rejects reserved domains", () => {
    expect(checkSyntax("  Owner@Sponsor.Example ").email).toBe("owner@sponsor.example");
    expect(checkSyntax("owner@sponsor.example").ok).toBe(true);
    expect(checkSyntax("owner@example.com").ok).toBe(false);
    expect(checkSyntax("owner@sub.example.org").ok).toBe(false);
    expect(checkSyntax("owner@test").ok).toBe(false);
    expect(checkSyntax("owner@foo.localhost").ok).toBe(false);
    expect(checkSyntax("owner@invalid").ok).toBe(false);
    expect(checkSyntax("no-at").ok).toBe(false);
    expect(checkSyntax("a b@sponsor.example").ok).toBe(false);
    expect(checkSyntax(`${"a".repeat(250)}@sponsor.example`).ok).toBe(false);
  });

  it("falls back to an A record and caches the domain", async () => {
    const calls: string[] = [];
    const client = dns({
      calls,
      resolveMx: async () => {
        throw Object.assign(new Error("missing"), { code: "ENOTFOUND" });
      },
    });
    const cache = new Map();
    const first = await lookupMx("sponsor.example", client, cache);
    const second = await lookupMx("sponsor.example", client, cache);
    expect(first.mxOk).toBe(true);
    expect(second.mxOk).toBe(true);
    expect(calls.filter((call) => call.startsWith("mx:"))).toHaveLength(1);
    expect(calls.filter((call) => call.startsWith("a:"))).toHaveLength(1);
    expect(calls.some((call) => call.startsWith("aaaa:"))).toBe(false);
  });

  it("leaves mx_ok null on timeout and skips MX after a syntax failure", async () => {
    const calls: string[] = [];
    const client = dns({
      calls,
      resolveMx: async () => {
        throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
      },
    });
    const cache = new Map();
    const timed = await lookupMx("slow.example", client, cache);
    expect(timed.mxOk).toBeNull();
    expect(calls.filter((call) => call.startsWith("mx:"))).toHaveLength(2);
    const checked = await checkEmails(
      [
        { source: "podscan", raw: "bad" },
        { source: "apple_rss", raw: "owner@slow.example" },
      ],
      client,
      new Map()
    );
    expect(checked[0]).toMatchObject({ syntaxOk: false, mxOk: null, status: "needs_manual_lookup" });
    expect(checked[1].mxOk).toBeNull();
    expect(emailStatus(true, null)).toBe("needs_manual_lookup");
    expect(emailStatus(true, true)).toBe("ok");
    expect(contactStatus(["needs_manual_lookup", "ok"])).toBe("ok");
    expect(contactStatus(["needs_manual_lookup"])).toBe("needs_manual_lookup");
    const tooLong = "a".repeat(250) + "@sponsor.example";
    const dropped = await checkEmails([{ source: "podscan", raw: tooLong }], client, new Map());
    expect(dropped).toEqual([]);
  });
});
