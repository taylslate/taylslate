// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import IOPreview from "./IOPreview";

const io = {
  io_number: "IO-1001",
  advertiser_name: "Northwind",
  advertiser_contact_name: "Brand",
  advertiser_contact_email: "brand@example.test",
  publisher_name: "Harbor",
  publisher_contact_name: "Host",
  publisher_contact_email: "host@example.test",
  agency_name: "Left Field",
  agency_contact_name: "Alex",
  agency_contact_email: "desk@example.test",
  send_invoices_to: "invoices@example.test",
  line_items: [],
  total_downloads: 0,
  total_gross: 0,
  total_net: 0,
  payment_terms: "Net 30 EOM",
  status: "draft" as const,
};

afterEach(cleanup);

describe("IOPreview contact flags", () => {
  it("leaves addresses in place when the flags are absent", () => {
    render(
      <IOPreview io={io} onEdit={vi.fn()} onConfirm={vi.fn()} />
    );
    expect(screen.getByText("brand@example.test")).toBeTruthy();
    expect(screen.getByText("host@example.test")).toBeTruthy();
    expect(screen.getByText("desk@example.test")).toBeTruthy();
    expect(screen.getByText("invoices@example.test")).toBeTruthy();
    expect(screen.queryByText("Sent through Taylslate")).toBeNull();
  });

  it("masks the publisher email only", () => {
    render(
      <IOPreview io={io} onEdit={vi.fn()} onConfirm={vi.fn()} publisherContactHidden />
    );
    expect(screen.getByText("brand@example.test")).toBeTruthy();
    expect(screen.queryByText("host@example.test")).toBeNull();
    expect(screen.getAllByText("Sent through Taylslate")).toHaveLength(1);
  });

  it("masks the advertiser, agency, and invoice addresses", () => {
    render(
      <IOPreview io={io} onEdit={vi.fn()} onConfirm={vi.fn()} advertiserContactHidden />
    );
    expect(screen.queryByText("brand@example.test")).toBeNull();
    expect(screen.queryByText("desk@example.test")).toBeNull();
    expect(screen.queryByText("invoices@example.test")).toBeNull();
    expect(screen.getByText("host@example.test")).toBeTruthy();
    expect(screen.getAllByText("Sent through Taylslate").length).toBeGreaterThanOrEqual(3);
  });
});
