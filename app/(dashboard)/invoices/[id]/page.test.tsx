// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InvoiceDetailPage from "./page";

const SECRET = "secret-brand@example.test";

const invoice = {
  id: "inv-1",
  invoice_number: "INV-1001",
  io_id: "io-1",
  io_number: "IO-1001",
  bill_to_name: "Jordan Lee",
  bill_to_email: SECRET,
  from_name: "Host",
  from_email: "host@show.test",
  advertiser_name: "SaunaBox",
  campaign_period: "March 2027",
  line_items: [
    {
      id: "li-1",
      io_line_item_id: "iol-1",
      show_name: "Daily Briefing",
      post_date: "2027-03-12",
      description: "Mid-roll",
      guaranteed_downloads: 10000,
      actual_downloads: 10000,
      rate: 250,
      make_good: false,
    },
  ],
  subtotal: 250,
  adjustments: 0,
  total_due: 250,
  status: "draft",
  due_date: "2027-04-30",
  created_at: "2027-03-01T00:00:00.000Z",
  updated_at: "2027-03-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ invoice }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("invoice detail recipient", () => {
  it("shows the bill-to name and masks the address", async () => {
    const params = {
      then() {},
      status: "fulfilled",
      value: { id: "inv-1" },
    } as unknown as Promise<{ id: string }>;
    render(<InvoiceDetailPage params={params} />);
    expect(await screen.findByText("INV-1001")).toBeTruthy();
    expect(screen.getByText("Jordan Lee")).toBeTruthy();
    expect(screen.getByText("Sent through Taylslate")).toBeTruthy();
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.getByText("host@show.test")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send Invoice" }));
    expect(screen.getByText(`Jordan Lee <Sent through Taylslate>`)).toBeTruthy();
    expect(screen.queryByText(SECRET)).toBeNull();
  });
});
