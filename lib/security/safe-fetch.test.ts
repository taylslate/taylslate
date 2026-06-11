import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }));

vi.mock("node:dns/promises", () => ({ lookup: mockLookup }));

import { isPrivateAddress, isUrlSafe, safeFetch } from "./safe-fetch";

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

  it.each(["8.8.8.8", "52.1.2.3", "172.15.0.1", "172.32.0.1", "1.1.1.1"])(
    "allows public IPv4 %s",
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  );

  it.each(["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:192.168.1.1"])(
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
  });
});
