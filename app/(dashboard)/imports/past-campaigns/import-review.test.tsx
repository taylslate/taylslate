// @vitest-environment jsdom

import type { ReactElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getEffectiveRole: vi.fn(),
  getProfilePlanId: vi.fn(),
  getBrandProfileByUserId: vi.fn(),
  getUserProfile: vi.fn(),
  createClient: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  getEffectiveRole: mocks.getEffectiveRole,
  getBrandProfileByUserId: mocks.getBrandProfileByUserId,
  getUserProfile: mocks.getUserProfile,
}));

vi.mock("@/lib/entitlements/plan", async () => {
  const actual = await vi.importActual<typeof import("@/lib/entitlements/plan")>(
    "@/lib/entitlements/plan",
  );
  return { ...actual, getProfilePlanId: mocks.getProfilePlanId };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import PastCampaignImportPage from "./page";

const BRAND_A = "11111111-1111-4111-8111-111111111111";
const BRAND_B = "22222222-2222-4222-8222-222222222222";
const SHOW_ID = "8f3c1a20-4b6e-4c11-9a2d-111111111111";

function expectNoEmDash(container: HTMLElement) {
  expect(container.textContent ?? "").not.toContain("\u2014");
  expect(container.innerHTML).not.toContain("\u2014");
}

function signedIn(role = "brand", plan = "pay_as_you_go") {
  mocks.getAuthenticatedUser.mockResolvedValue({ id: BRAND_A });
  mocks.getEffectiveRole.mockResolvedValue({ effectiveRole: role });
  mocks.getProfilePlanId.mockResolvedValue(plan);
  mocks.getBrandProfileByUserId.mockResolvedValue({ brand_name: "Sauna Box" });
  mocks.getUserProfile.mockResolvedValue({ company_name: "Sauna Box LLC" });
}

function showsClient() {
  return {
    from(table: string) {
      let name = "";
      const builder = {
        select() {
          return builder;
        },
        ilike(_column: string, value: string) {
          name = value;
          return builder;
        },
        limit() {
          if (table !== "shows") return Promise.resolve({ data: [], error: null });
          const rows =
            name.trim().toLowerCase() === "acquired"
              ? [{ id: SHOW_ID, name: "Acquired" }]
              : [];
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
  };
}

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  signedIn();
  mocks.createClient.mockResolvedValue(showsClient());
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/api/deals/import")) {
      return jsonResponse({
        source: "past_campaign",
        source_kind: "csv",
        file_name: "sauna-box-q1.csv",
        drafts: [
          {
            show_name: "Acquired",
            matched_show_id: SHOW_ID,
            flight_start: "2025-06-02",
            flight_end: "2025-06-23",
            placement: "mid-roll",
            price_type: "cpm",
            rate: 28,
            episodes: 3,
            spend: 5100,
            conversions: 86,
            downloads: 180000,
            raw: { Podcast: "Acquired" },
          },
          {
            show_name: "Mystery Hour",
            matched_show_id: null,
            flight_start: "2025-07-07",
            flight_end: "2025-07-28",
            placement: "pre-roll",
            price_type: "flat",
            rate: 8000,
            episodes: 3,
            spend: 8000,
            conversions: 41,
            downloads: 95000,
            raw: { Podcast: "Mystery Hour" },
          },
        ],
      });
    }
    if (String(url).includes("/api/imports/past-campaigns")) {
      const sent = JSON.parse(String(init?.body));
      return jsonResponse(
        {
          import: { id: "import-1", brand_id: BRAND_A },
          records: sent.records.map((row: object, index: number) => ({
            id: `rec-${index + 1}`,
            ...row,
          })),
        },
        201,
      );
    }
    throw new Error(`unexpected ${String(url)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderPage(node: Promise<ReactElement> = PastCampaignImportPage()) {
  const view = render(await node);
  expectNoEmDash(view.container);
  return view;
}

async function reviewRows() {
  const user = userEvent.setup();
  const file = new File(["show\nAcquired"], "sauna-box-q1.csv", { type: "text/csv" });
  await user.upload(screen.getByLabelText("Choose a CSV, XLSX, or PDF file"), file);
  await user.click(screen.getByRole("button", { name: "Review rows" }));
  await waitFor(() => {
    expect(screen.getByTestId("import-step")).toHaveTextContent("Step 2 of 4. Edit the rows.");
  });
  return user;
}

describe("past campaign import review", () => {
  it("walks upload, review, and consent, then confirms once for the session brand", async () => {
    const view = await renderPage();
    expect(screen.getByTestId("import-step")).toHaveTextContent("Step 1 of 4. Add the file.");
    expect(view.container).toHaveTextContent(
      "The catalog suggestion is advisory. The brand keeps the row either way.",
    );

    const user = await reviewRows();
    expect(screen.getByTestId("match-row-1")).toHaveTextContent(
      "Catalog suggestion: Acquired. The imported name stays unless you change it.",
    );
    expect(screen.getByTestId("match-row-2")).toHaveTextContent("No catalog suggestion.");
    expect(screen.getByTestId("match-row-1")).not.toHaveTextContent(SHOW_ID);

    await user.click(screen.getAllByRole("button", { name: "Remove" })[1]);
    await user.click(screen.getByRole("button", { name: "Continue to consent" }));
    expect(screen.getByTestId("import-step")).toHaveTextContent("Step 3 of 4. Consent.");
    expect(
      screen.getByRole("checkbox", { name: "Allow a later anonymized pool for this file." }),
    ).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Confirm import" }));
    await waitFor(() => {
      expect(screen.getByTestId("import-confirmed")).toBeInTheDocument();
    });
    expect(screen.getByTestId("import-step")).toHaveTextContent("Step 4 of 4. Confirmed.");
    expect(screen.getByTestId("import-confirmed")).toHaveTextContent("1 record saved.");
    expect(view.container).toHaveTextContent(
      "Pooling consent: no. This file stays private to the brand.",
    );

    const saveCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/api/imports/past-campaigns"),
    );
    expect(saveCalls).toHaveLength(1);
    const sent = JSON.parse(String(saveCalls[0][1].body));
    expect(sent.brand_id).toBe(BRAND_A);
    expect(sent.brand_id).not.toBe(BRAND_B);
    expect(JSON.stringify(sent)).not.toContain(BRAND_B);
    expect(sent.pooling_consent).toBe(false);
    expect(sent.terms_version).toBeNull();
    expect(sent.records).toHaveLength(1);
    expect(sent.records[0].show_name).toBe("Acquired");
    expect(sent.records[0].matched_show_id).toBeNull();
    expect(JSON.stringify(sent.records)).not.toContain(SHOW_ID);
    expectNoEmDash(view.container);
  });

  it("shows a parse error as the API returned it", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ error: "File must be under 10MB" }, 400),
    );
    const user = userEvent.setup();
    await renderPage();
    const file = new File(["x"], "big.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText("Choose a CSV, XLSX, or PDF file"), file);
    await user.click(screen.getByRole("button", { name: "Review rows" }));
    expect(await screen.findByTestId("import-error")).toHaveTextContent("File must be under 10MB");
    expect(screen.getByTestId("import-step")).toHaveTextContent("Step 1 of 4. Add the file.");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/imports/past-campaigns"))).toBe(
      false,
    );
  });

  it("blocks confirm when a price is not a number", async () => {
    await renderPage();
    const user = await reviewRows();
    const price = screen.getByRole("textbox", { name: "Price 1" });
    await user.clear(price);
    await user.type(price, "not-a-price");
    await user.click(screen.getByRole("button", { name: "Continue to consent" }));
    expect(screen.getByTestId("import-step")).toHaveTextContent("Step 2 of 4. Edit the rows.");
    expect(screen.getByTestId("import-error")).toHaveTextContent(
      "Enter a price as a number, or leave it blank.",
    );
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/imports/past-campaigns"))).toBe(
      false,
    );
  });

  it("discards locally and does not call the save API", async () => {
    await renderPage();
    const user = await reviewRows();
    await user.click(screen.getByRole("button", { name: "Discard import" }));
    expect(screen.getByTestId("import-step")).toHaveTextContent("Import discarded.");
    expect(screen.getByText("Nothing from sauna-box-q1.csv was saved.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/imports/past-campaigns"))).toBe(
      false,
    );
  });

  it("lets a Free brand open the screen", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { name: "Past campaign import" })).toBeInTheDocument();
    expect(screen.getByText(/Sauna Box brings in an old campaign file/)).toBeInTheDocument();
  });

  it("sends a show account to the dashboard", async () => {
    signedIn("show", "pay_as_you_go");
    await expect(PastCampaignImportPage()).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("sends an agent account to the dashboard", async () => {
    signedIn("agent", "pay_as_you_go");
    await expect(PastCampaignImportPage()).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("sends a signed-out visit to login", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    await expect(PastCampaignImportPage()).rejects.toThrow("REDIRECT:/login");
  });
});
