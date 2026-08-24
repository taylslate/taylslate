// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Wave12Deal } from "@/lib/data/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@stripe/stripe-js", () => ({
  loadStripe: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardElement: () => <div data-testid="card-element" />,
  useElements: () => ({ getElement: vi.fn() }),
  useStripe: () => ({ confirmCardSetup: vi.fn() }),
}));

import Wave12DealClient from "./Wave12DealClient";

const baseDeal: Wave12Deal = {
  id: "deal_12345678",
  outreach_id: "out_1",
  brand_profile_id: "bp_1",
  show_profile_id: "sp_1",
  status: "brand_signed",
  agreed_cpm: 30,
  agreed_episode_count: 3,
  agreed_placement: "mid-roll",
  agreed_flight_start: "2026-08-20",
  agreed_flight_end: "2026-09-20",
  docusign_envelope_id: "env_1",
  brand_signed_at: "2026-08-12T12:00:00Z",
  show_signed_at: null,
  signed_io_pdf_url: null,
  signature_certificate_url: null,
  setup_intent_id: "seti_1",
  setup_intent_client_secret: "seti_1_secret_abc",
  payment_method_id: null,
  promo_code: null,
  created_at: "2026-08-12T00:00:00Z",
  updated_at: "2026-08-12T00:00:00Z",
};

function renderDeal(
  overrides: Partial<Wave12Deal> = {},
  viewerRole: "brand" | "show" = "brand"
) {
  return render(
    <Wave12DealClient
      deal={{ ...baseDeal, ...overrides }}
      showName="The Daily Build"
      brandName="Aurora Sleep"
      viewerRole={viewerRole}
    />
  );
}

afterEach(() => cleanup());

describe("Wave12DealClient payment method card", () => {
  it("asks the brand to add a card after brand signature when the deal has a SetupIntent", () => {
    renderDeal();

    expect(screen.getByText("Payment method")).toBeInTheDocument();
    expect(screen.getByText(/Add the card Taylslate should charge/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add card on file/i })).toBeInTheDocument();
  });

  it("shows a waiting state while the DocuSign-triggered SetupIntent is not present yet", () => {
    renderDeal({ setup_intent_id: null, setup_intent_client_secret: null });

    expect(screen.getByText("Payment method")).toBeInTheDocument();
    expect(screen.getByText(/Card setup will appear after DocuSign confirms/i)).toBeInTheDocument();
  });

  it("recovers a missing SetupIntent on demand and then mounts the card form", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ publishableKey: "pk_test_x" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "created", client_secret: "seti_new_secret" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    renderDeal({ setup_intent_id: null, setup_intent_client_secret: null });
    fireEvent.click(screen.getByRole("button", { name: /add card on file/i }));

    // Elements mounts (mocked) once we have publishable key + recovered secret.
    expect(await screen.findByTestId("card-element")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/stripe/config");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/deals/deal_12345678/setup-intent", {
      method: "POST",
    });

    vi.unstubAllGlobals();
  });

  it("shows the saved state once Stripe has attached a payment method to the deal", () => {
    renderDeal({ payment_method_id: "pm_123" });

    expect(screen.getByText("Payment method")).toBeInTheDocument();
    expect(screen.getByText("Card on file saved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add card on file/i })).not.toBeInTheDocument();
  });

  it("does not show brand payment setup to the show viewer", () => {
    renderDeal({}, "show");

    expect(screen.queryByText("Payment method")).not.toBeInTheDocument();
  });
});
