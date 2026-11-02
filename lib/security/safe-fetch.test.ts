import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }));

vi.mock("node:dns/promises", () => ({ lookup: mockLookup }));

import { readBodyCapped, contentTypeAllowed, safeFetch } from "./safe-fetch";
import { isPrivateAddress, isUrlSafe } from "./safe-fetch";

const PUBLIC_DNS = [{ address: "93.184.216.34", family: 4 }];

function redirectResponse(location: string, status = 302) {
  return { ok: false, status, headers: new Headers({ location }) } as Response;
}

function okResponse() {
  return { ok: true, status: 200, headers: new Headers() } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLookup.mockResolvedValue(PUBLIC_DNS);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isPrivateAddress", () => {
  it.each([
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "192.168.255.255",
    "127.0.0.1",
    "127.255.255.250",
    "169.254.169.254",
    "0.0.0.0",
  ])("blocks private IPv4 %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    "100.64.0.1",
    "100.127.255.255",
    "198.18.0.1",
    "198.19.255.255",
    "224.0.0.1",
    "239.255.255.255",
  ])("blocks non-routable IPv4 %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "52.1.2.3", "172.15.0.1", "172.32.0.1", "1.1.1.1", "100.63.255.255", "100.128.0.1", "223.255.255.255"])(
    "allows public IPv4 %s",
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  );

  it.each([
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:10.0.0.1",
    "::ffff:192.168.1.1",
    "::ffff:a9fe:a9fe",
    "::127.0.0.1",
    "::7f00:1",
    "64:ff9b::",
    "64:ff9b::8.8.8.8",
    "64:ff9b::a9fe:a9fe",
  ])(
    "blocks private IPv6 %s",
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  );

  it.each(["2606:4700::1", "2001:4860:4860::8888", "::ffff:8.8.8.8"])(
    "allows public IPv6 %s",
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  );
});

describe("isUrlSafe", () => {
  it("rejects non-http(s) protocols", async () => {
    expect(await isUrlSafe(new URL("ftp://example.com"))).toBe(false);
    expect(await isUrlSafe(new URL("file:///etc/passwd"))).toBe(false);
  });

  it("rejects localhost and *.localhost", async () => {
    expect(await isUrlSafe(new URL("http://localhost:3000"))).toBe(false);
    expect(await isUrlSafe(new URL("http://app.localhost"))).toBe(false);
  });

  it("rejects literal private IPs without a DNS lookup", async () => {
    expect(await isUrlSafe(new URL("http://10.0.0.5/admin"))).toBe(false);
    expect(await isUrlSafe(new URL("http://[::1]/"))).toBe(false);
    expect(await isUrlSafe(new URL("http://[::ffff:a9fe:a9fe]/"))).toBe(false);
    expect(await isUrlSafe(new URL("http://[::127.0.0.1]/"))).toBe(false);
    expect(await isUrlSafe(new URL("http://[64:ff9b::a9fe:a9fe]/"))).toBe(false);
    expect(await isUrlSafe(new URL("http://100.64.1.1/"))).toBe(false);
    expect(await isUrlSafe(new URL("http://198.18.0.1/"))).toBe(false);
    expect(await isUrlSafe(new URL("http://224.0.0.1/"))).toBe(false);
    expect(await isUrlSafe(new URL("http://metadata.google.internal/computeMetadata/v1/"))).toBe(
      false
    );
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("allows literal public IPs without a DNS lookup", async () => {
    expect(await isUrlSafe(new URL("http://8.8.8.8/"))).toBe(true);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("allows hostnames that resolve to public addresses", async () => {
    expect(await isUrlSafe(new URL("https://example.com"))).toBe(true);
    expect(mockLookup).toHaveBeenCalledWith("example.com", { all: true });
  });

  it("rejects hostnames that resolve to a private address", async () => {
    mockLookup.mockResolvedValue([{ address: "192.168.1.10", family: 4 }]);
    expect(await isUrlSafe(new URL("https://internal.example.com"))).toBe(false);
  });

  it("rejects hostnames where any resolved address is private", async () => {
    mockLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    expect(await isUrlSafe(new URL("https://mixed.example.com"))).toBe(false);
  });

  it("rejects hostnames that fail to resolve", async () => {
    mockLookup.mockRejectedValue(new Error("ENOTFOUND"));
    expect(await isUrlSafe(new URL("https://nope.example.com"))).toBe(false);
  });
});

describe("safeFetch", () => {
  it("returns null on a blocked initial URL without fetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(await safeFetch("http://127.0.0.1:8080/")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks a redirect to a private address", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(redirectResponse("http://192.168.1.1/admin"));
    vi.stubGlobal("fetch", fetchSpy);

    expect(await safeFetch("https://example.com")).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect to a public address", async () => {
    const final = okResponse();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse("https://example.com/home", 301))
      .mockResolvedValueOnce(final);
    vi.stubGlobal("fetch", fetchSpy);

    expect(await safeFetch("https://example.com")).toBe(final);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toBe("https://example.com/home");
    const init = fetchSpy.mock.calls[0][1] as { dispatcher?: { close: () => Promise<void> } };
    expect(init.dispatcher).toBeTruthy();
  });

  it("pins the first resolved address and ignores a later DNS answer", async () => {
    mockLookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    const fetchSpy = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchSpy);
    expect(await safeFetch("https://example.com")).toBeTruthy();
    const init = fetchSpy.mock.calls[0][1] as {
      dispatcher?: {
        pinnedLookup?: (
          hostname: string,
          options: unknown,
          callback: (err: null, address: string, family: number) => void
        ) => void;
      };
    };
    const pinned = init.dispatcher?.pinnedLookup;
    expect(pinned).toBeTypeOf("function");
    await new Promise<void>((resolve) => {
      pinned?.("169.254.169.254.example", {}, (err, address, family) => {
        expect(err).toBeNull();
        expect(address).toBe("93.184.216.34");
        expect(family).toBe(4);
        resolve();
      });
    });
    expect(mockLookup).toHaveBeenCalledTimes(1);
  });

  it("aborts a hung connection at the timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      })
    );
    expect(await safeFetch("https://example.com", {}, 5, { timeoutMs: 30 })).toBeNull();
  });

  it("resolves relative redirect targets against the current URL", async () => {
    const final = okResponse();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse("/landing"))
      .mockResolvedValueOnce(final);
    vi.stubGlobal("fetch", fetchSpy);

    expect(await safeFetch("https://example.com/start")).toBe(final);
    expect(fetchSpy.mock.calls[1][0]).toBe("https://example.com/landing");
  });

  it("returns null on a redirect without a Location header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 302, headers: new Headers() })
    );
    expect(await safeFetch("https://example.com")).toBeNull();
  });

  it("returns null when the redirect cap is exceeded", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(redirectResponse("https://example.com/again"));
    vi.stubGlobal("fetch", fetchSpy);

    expect(await safeFetch("https://example.com", {}, 5)).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(6); // initial + 5 redirects
  });

  it("returns null when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    expect(await safeFetch("https://example.com")).toBeNull();
  });

  it("always fetches with redirect: manual", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchSpy);

    await safeFetch("https://example.com", { headers: { Accept: "text/html" } });
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      redirect: "manual",
      headers: { Accept: "text/html" },
    });
    expect((fetchSpy.mock.calls[0][1] as { signal?: AbortSignal }).signal).toBeInstanceOf(
      AbortSignal
    );
  });
});

describe("readBodyCapped", () => {
  it("cancels the stream once the cap is passed", async () => {
    let pulls = 0;
    const stream = new ReadableStream({
      pull(controller) {
        pulls += 1;
        if (pulls > 4) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(8));
      },
    });
    const res = new Response(stream);
    const body = await readBodyCapped(res, 16);
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.error).toMatch(/exceeded 16/);
    expect(pulls).toBeLessThanOrEqual(3);
  });

  it("accepts rss and audio types and rejects html", () => {
    expect(contentTypeAllowed("application/rss+xml; charset=utf-8", "rss")).toBe(true);
    expect(contentTypeAllowed("text/html", "rss")).toBe(false);
    expect(contentTypeAllowed("audio/mpeg", "audio")).toBe(true);
    expect(contentTypeAllowed("text/html", "audio")).toBe(false);
    expect(contentTypeAllowed(null, "audio")).toBe(false);
  });
});
