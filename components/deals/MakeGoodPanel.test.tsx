// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MakeGoodRecord } from "@/lib/make-goods/types";
import MakeGoodPanel from "./MakeGoodPanel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const proposal: MakeGoodRecord = {
  id: "mg_1",
  deal_id: "deal_1",
  io_id: "io_1",
  io_line_item_id: "li_1",
  aircheck_id: "ac_1",
  show_id: "show_1",
  kind: "missed",
  status: "proposed",
  delivery_state: "pending_approval",
  reason: "Aircheck rejected: the spot did not run.",
  show_name: "Huberman Lab",
  placement: "mid-roll",
  post_date: "2026-08-01",
  guaranteed_downloads: 10000,
  actual_downloads: null,
  shortfall_pct: null,
  threshold: 0.1,
  options: [
    {
      id: "replacement_spot",
      label: "Additional episode",
      summary: "Publisher airs one additional mid-roll episode at no additional cost.",
    },
    {
      id: "reair",
      label: "Re-air the spot",
      summary: "Publisher re-airs the same mid-roll spot at no additional cost.",
    },
  ],
  selected_option: null,
  amended_terms: "Draft amendment",
  credit_amount: null,
  replacement_line_item_id: null,
  replacement_post_date: null,
  decided_by: null,
  decided_at: null,
  created_at: "2026-08-20T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MakeGoodPanel", () => {
  it("renders nothing until a deal view supplies the list", () => {
    render(<MakeGoodPanel dealId="deal_1" />);
    expect(screen.queryByRole("heading", { name: "Make-good" })).not.toBeInTheDocument();
  });

  it("lets the brand approve a remedy", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        make_good: { ...proposal, status: "approved", selected_option: "replacement_spot" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MakeGoodPanel dealId="deal_1" canApprove proposals={[proposal]} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve Additional episode" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/deals/deal_1/make-goods/mg_1/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ option: "replacement_spot" }),
    });
  });

  it("does not offer approval to the show", () => {
    render(<MakeGoodPanel dealId="deal_1" canApprove={false} proposals={[proposal]} />);
    expect(screen.getByText("Waiting on the brand.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /decline/i })).not.toBeInTheDocument();
  });
});
