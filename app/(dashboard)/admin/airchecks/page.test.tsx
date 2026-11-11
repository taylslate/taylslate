// @vitest-environment jsdom

import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { getAuthenticatedUser, loadAircheckQueue } = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  loadAircheckQueue: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
}));

vi.mock("@/lib/airchecks/store", () => ({
  loadAircheckQueue: (...args: unknown[]) => loadAircheckQueue(...args),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import AircheckQueuePage from "./page";

const LINE = "11111111-1111-4111-8111-111111111111";
const FAILED = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INTERNAL_ADMIN_EMAILS = "ops@taylslate.com";
  loadAircheckQueue.mockResolvedValue({
    ready: [
      {
        id: "ac_ready",
        ioLineItemId: LINE,
        showName: "Huberman Lab",
        advertiserName: "Sauna Box",
        placement: "mid-roll",
        matchResult: "matched",
        confidence: 0.8,
        matchedAt: "2026-11-02T00:00:00.000Z",
        chargeError: null,
      },
    ],
    chargeFailed: [
      {
        id: "ac_failed",
        ioLineItemId: FAILED,
        showName: "Failed Show",
        advertiserName: null,
        placement: "pre-roll",
        matchResult: "not_matched",
        confidence: null,
        matchedAt: null,
        chargeError: "card declined",
      },
    ],
  });
});

afterEach(() => {
  cleanup();
});

describe("aircheck queue page", () => {
  it("shows the admin gate when there is no session", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);
    render(await AircheckQueuePage());
    expect(screen.getByText("This page is for Taylslate admins.")).toBeInTheDocument();
    expect(loadAircheckQueue).not.toHaveBeenCalled();
  });

  it("shows the admin gate for a signed-in user who is not an admin", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "u1",
      email: "random@notallowed.com",
    });
    render(await AircheckQueuePage());
    expect(screen.getByText("This page is for Taylslate admins.")).toBeInTheDocument();
    expect(loadAircheckQueue).not.toHaveBeenCalled();
    expect(screen.queryByText("Huberman Lab")).not.toBeInTheDocument();
  });

  it("lists ready rows and charge-failed rows with a link to each line", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "admin_1",
      email: "ops@taylslate.com",
    });
    render(await AircheckQueuePage());
    expect(screen.getByRole("heading", { name: "Review queue" })).toBeInTheDocument();
    for (const name of [
      "Show",
      "Advertiser",
      "Placement",
      "Match result",
      "Confidence",
      "Matched date",
    ]) {
      expect(screen.getAllByRole("columnheader", { name })).toHaveLength(2);
    }
    expect(screen.getByText("Huberman Lab")).toBeInTheDocument();
    expect(screen.getByText("Sauna Box")).toBeInTheDocument();
    expect(screen.getByText("Failed Show")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("Not matched")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "Review" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      `/admin/airchecks/${LINE}`,
      `/admin/airchecks/${FAILED}`,
    ]);
    expect(screen.queryByText("card declined")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/transcript|audio\.example/);
  });

  it("does not select a transcript, an audio url, or decided_by", () => {
    const source = readFileSync(join(__dirname, "page.tsx"), "utf8");
    expect(source).not.toMatch(/transcript_text|audio_url|decided_by/);
    expect(source).toContain("This page is for Taylslate admins.");
  });
});
