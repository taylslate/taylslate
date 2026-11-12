// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { OwnershipDetail, OwnershipQueueRow } from "@/lib/ownership/review";

const mocks = vi.hoisted(() => ({
  user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } as { id: string } | null,
  admin: true,
  list: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: async () => mocks.user,
}));

vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin: async () => mocks.admin,
}));

vi.mock("@/lib/ownership/review", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ownership/review")>("@/lib/ownership/review");
  return { ...actual, listOwnershipQueue: (...args: unknown[]) => mocks.list(...args) };
});

import OwnershipReviewPage from "./page";
import { OwnershipReviewClient } from "./ownership-review-client";

const PROOF = "44444444-4444-4444-8444-444444444444";

function row(overrides: Partial<OwnershipQueueRow> = {}): OwnershipQueueRow {
  return {
    id: PROOF,
    show_name: "Odd Lots",
    method: "rss_code",
    status: "contested",
    target: "feeds.example.com/show",
    requester_email: "owner@example.com",
    miss_count: 5,
    last_checked_at: "2026-02-01T00:00:00.000Z",
    created_at: "2026-01-15T00:00:00.000Z",
    note: "needs_admin_review",
    exclusive_rep: true,
    rep_label: "Northwind",
    ...overrides,
  };
}

function detail(): OwnershipDetail {
  return {
    proof: {
      ...row(),
      rss_url: "https://feeds.example.com/show",
      youtube_channel_id: null,
      ownership_status: "unclaimed",
      decision_note: null,
      decided_at: null,
    },
    other_proofs: [
      {
        status: "rejected",
        method: "admin",
        created_at: "2026-01-01T00:00:00.000Z",
        decided_at: "2026-01-02T00:00:00.000Z",
        decided_by_email: "admin@example.com",
      },
    ],
    rep_links: [{ rep_label: "Northwind", status: "approved", is_exclusive: true }],
  };
}

describe("admin ownership review", () => {
  beforeEach(() => {
    mocks.user = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    mocks.admin = true;
    mocks.list.mockResolvedValue({ ok: true, proofs: [] });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("hides the page from a signed-out visitor and a non-admin", async () => {
    mocks.user = null;
    await expect(OwnershipReviewPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
    mocks.user = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    mocks.admin = false;
    await expect(OwnershipReviewPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("shows the empty state", async () => {
    render(await OwnershipReviewPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { name: "Ownership review" })).toBeInTheDocument();
    expect(screen.getByText("No proofs need review.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("\u2014");
  });

  it("shows the list, detail, and a decided notice", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => detail(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, status: "verified" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<OwnershipReviewClient proofs={[row(), row({ id: "55555555-5555-4555-8555-555555555555", show_name: "Sibling", exclusive_rep: false, rep_label: null })]} filter={null} error={null} />);
    expect(screen.getByText("Odd Lots")).toBeInTheDocument();
    expect(screen.getByText("Exclusive rep: Northwind")).toBeInTheDocument();
    expect(screen.getByText("No approved exclusive rep")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Odd Lots/ }));
    expect(await screen.findByText("Review the rep link in roster requests.")).toBeInTheDocument();
    expect(screen.getByText(/RSS: https:\/\/feeds\.example\.com\/show/)).toBeInTheDocument();
    expect(screen.getByText(/admin@example.com/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Verified.");
    expect(screen.queryByText("Odd Lots")).not.toBeInTheDocument();
    expect(screen.getByText("Sibling")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("\u2014");
  });

  it("rejects with a reason and hides a database message", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => detail() })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "secret-db-text 44444444-4444-4444-8444-444444444444" }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, status: "rejected" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<OwnershipReviewClient proofs={[row()]} filter="contested" error={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Odd Lots/ }));
    expect(await screen.findByRole("button", { name: "Reject" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "The feed does not match." } });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reject that proof.");
    expect(document.body.textContent).not.toContain("secret-db-text");

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Not verified.");
    const body = JSON.parse(String(fetchMock.mock.calls[2][1].body));
    expect(body).toEqual({ action: "reject", reason: "The feed does not match." });
    expect(body.decided_by).toBeUndefined();
  });
});
