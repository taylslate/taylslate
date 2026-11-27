// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InvoicesPage from "./page";

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

const sends: unknown[] = [];

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  sends.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/invoices/send")) {
        sends.push(JSON.parse(String(init?.body ?? "{}")));
        return json({ success: true, to: SECRET, toName: "Jordan Lee" });
      }
      if (url.endsWith("/api/invoices/generate")) {
        return json({ invoice: { ...invoice, id: "inv-gen", invoice_number: "INV-1002" } });
      }
      if (url.endsWith("/api/invoices")) {
        return json({
          invoices: [invoice],
          stats: { total_outstanding: 250, total_paid_this_month: 0, count_by_status: { draft: 1 } },
        });
      }
      if (url.endsWith("/api/deals")) {
        return json({ deals: [{ id: "deal-1", status: "live" }] });
      }
      if (url.includes("/api/deals/deal-1/io")) {
        return json({
          io: {
            id: "io-1",
            io_number: "IO-1001",
            advertiser_name: "SaunaBox",
            line_items: [{ id: "li", actual_post_date: "2027-03-12", verified: false, net_due: 250 }],
          },
        });
      }
      return json({ error: "missing" }, 404);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("invoices page recipient", () => {
  it("masks the recipient and sends an existing invoice by id", async () => {
    render(<InvoicesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Send" }));
    expect(screen.getByText("Jordan Lee")).toBeTruthy();
    expect(screen.getAllByText("Sent through Taylslate").length).toBeGreaterThan(0);
    expect(screen.queryByText(SECRET)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Send Now" }));
    await waitFor(() => expect(sends).toEqual([{ invoice_id: "inv-1" }]));
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.getAllByText("Sent through Taylslate").length).toBeGreaterThan(0);
  });

  it("sends a generated invoice by id and does not post the invoice object", async () => {
    render(<InvoicesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate Invoice" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "io-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByText("INV-1002")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send via Email" }));
    expect(screen.queryByText(SECRET)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send Now" }));
    await waitFor(() => expect(sends).toEqual([{ invoice_id: "inv-gen" }]));
    expect(JSON.stringify(sends)).not.toContain("bill_to_email");
    expect(JSON.stringify(sends)).not.toContain(SECRET);
  });
});
