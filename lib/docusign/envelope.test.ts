import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the JWT client so no network/auth happens. verifyEnvelopeTabsPlaced only
// touches getDocuSignClient() → sdk.EnvelopesApi → listTabs.
const getDocuSignClient = vi.fn();
vi.mock("./client", () => ({
  getDocuSignClient: (...args: unknown[]) => getDocuSignClient(...args),
  _resetDocuSignTokenCache: vi.fn(),
}));

import { getShowSigningUrl, verifyEnvelopeTabsPlaced } from "./envelope";

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

type ShowViewFns = {
  listRecipients: ReturnType<typeof vi.fn>;
  updateRecipients: ReturnType<typeof vi.fn>;
  createRecipientView: ReturnType<typeof vi.fn>;
};

function clientWithShowView(overrides: Partial<ShowViewFns> = {}) {
  const fns: ShowViewFns = {
    listRecipients: vi.fn().mockResolvedValue({
      signers: [
        { recipientId: "1", email: "brand@x.com", name: "Brand", clientUserId: "brand" },
        { recipientId: "2", email: "show@x.com", name: "Show Owner" },
      ],
    }),
    updateRecipients: vi.fn().mockResolvedValue({}),
    createRecipientView: vi.fn().mockResolvedValue({
      url: "https://demo.docusign.net/signing/show",
    }),
    ...overrides,
  };
  return {
    fns,
    client: {
      api: {},
      accountId: "acct-1",
      sdk: {
        EnvelopesApi: class {
          listRecipients = fns.listRecipients;
          updateRecipients = fns.updateRecipients;
          createRecipientView = fns.createRecipientView;
        },
        RecipientViewRequest: { constructFromObject: (o: unknown) => o },
        Signer: { constructFromObject: (o: unknown) => o },
        Recipients: { constructFromObject: (o: unknown) => o },
      },
    },
  };
}

const showSigningInput = {
  envelopeId: "env-1",
  signer: { name: "Show Owner", email: "show@x.com", clientUserId: "show" },
  returnUrl: "https://www.taylslate.com/api/deals/deal_1/docusign-return",
};

describe("getShowSigningUrl", () => {
  it("creates a recipient view for the show (recipient 2), not the brand", async () => {
    const { client, fns } = clientWithShowView();
    getDocuSignClient.mockResolvedValue(client);

    const res = await getShowSigningUrl(showSigningInput);
    expect(res.url).toBe("https://demo.docusign.net/signing/show");
    expect(fns.createRecipientView).toHaveBeenCalledWith(
      "acct-1",
      "env-1",
      expect.objectContaining({
        recipientViewRequest: expect.objectContaining({
          recipientId: "2",
          clientUserId: "show",
          email: "show@x.com",
        }),
      })
    );
  });

  it("adds clientUserId on the show recipient when the envelope was an email signer", async () => {
    const { client, fns } = clientWithShowView();
    getDocuSignClient.mockResolvedValue(client);

    await getShowSigningUrl(showSigningInput);
    expect(fns.updateRecipients).toHaveBeenCalledTimes(1);
    expect(fns.updateRecipients).toHaveBeenCalledWith(
      "acct-1",
      "env-1",
      expect.objectContaining({
        recipients: expect.objectContaining({
          signers: [
            expect.objectContaining({
              recipientId: "2",
              clientUserId: "show",
              email: "show@x.com",
            }),
          ],
        }),
      })
    );
  });

  it("skips updateRecipients when the show recipient is already embedded", async () => {
    const { client, fns } = clientWithShowView({
      listRecipients: vi.fn().mockResolvedValue({
        signers: [
          {
            recipientId: "2",
            email: "show@x.com",
            name: "Show Owner",
            clientUserId: "show",
          },
        ],
      }),
    });
    getDocuSignClient.mockResolvedValue(client);

    await getShowSigningUrl(showSigningInput);
    expect(fns.updateRecipients).not.toHaveBeenCalled();
    expect(fns.createRecipientView).toHaveBeenCalledTimes(1);
  });
});
