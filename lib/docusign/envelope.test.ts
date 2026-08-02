import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the JWT client so no network/auth happens. verifyEnvelopeTabsPlaced only
// touches getDocuSignClient() → sdk.EnvelopesApi → listTabs.
const getDocuSignClient = vi.fn();
vi.mock("./client", () => ({
  getDocuSignClient: (...args: unknown[]) => getDocuSignClient(...args),
  _resetDocuSignTokenCache: vi.fn(),
}));

import { verifyEnvelopeTabsPlaced } from "./envelope";

type ListTabsFn = (
  accountId: string,
  envelopeId: string,
  recipientId: string
) => Promise<unknown>;

function clientWithListTabs(listTabs: ListTabsFn) {
  return {
    api: {},
    accountId: "acct-1",
    sdk: {
      EnvelopesApi: class {
        listTabs = listTabs;
      },
    },
  };
}

const placedTab = (page: string) => ({
  signHereTabs: [{ pageNumber: page, xPosition: "38", yPosition: "76" }],
});

beforeEach(() => {
  getDocuSignClient.mockReset();
});

describe("verifyEnvelopeTabsPlaced", () => {
  it("ok when both recipients have a resolved SignHere tab", async () => {
    getDocuSignClient.mockResolvedValue(clientWithListTabs(async () => placedTab("2")));
    const res = await verifyEnvelopeTabsPlaced("env-1");
    expect(res.ok).toBe(true);
    expect(res.missing).toEqual([]);
  });

  it("reports the recipient whose anchor did not resolve", async () => {
    getDocuSignClient.mockResolvedValue(
      clientWithListTabs(async (_a, _e, rid) =>
        rid === "1" ? placedTab("1") : { signHereTabs: [] }
      )
    );
    const res = await verifyEnvelopeTabsPlaced("env-1");
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(["2"]);
  });

  it("treats a tab with no numeric position as unplaced (both recipients)", async () => {
    getDocuSignClient.mockResolvedValue(
      clientWithListTabs(async () => ({
        signHereTabs: [{ anchorString: "x", pageNumber: undefined }],
      }))
    );
    const res = await verifyEnvelopeTabsPlaced("env-1");
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(["1", "2"]);
  });

  it("treats a real page with blank/null x or y as unplaced (no 0-coercion)", async () => {
    getDocuSignClient.mockResolvedValue(
      clientWithListTabs(async () => ({
        signHereTabs: [{ pageNumber: "2", xPosition: "", yPosition: null }],
      }))
    );
    const res = await verifyEnvelopeTabsPlaced("env-1");
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(["1", "2"]);
  });

  it("never throws when listTabs rejects — returns a non-fatal result", async () => {
    getDocuSignClient.mockResolvedValue(
      clientWithListTabs(async () => {
        throw new Error("boom");
      })
    );
    const res = await verifyEnvelopeTabsPlaced("env-1");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("boom");
  });

  it("never throws when getDocuSignClient itself rejects", async () => {
    getDocuSignClient.mockRejectedValue(new Error("auth down"));
    const res = await verifyEnvelopeTabsPlaced("env-1");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("auth down");
  });

  it("times out gracefully when listTabs hangs (never blocks the caller)", async () => {
    getDocuSignClient.mockResolvedValue(
      clientWithListTabs(() => new Promise<unknown>(() => {})) // never resolves
    );
    const res = await verifyEnvelopeTabsPlaced("env-1", 20);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/timed out/);
  });
});
