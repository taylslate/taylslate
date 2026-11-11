// @vitest-environment jsdom

import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  role: "other" as "brand" | "other" | "error",
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: async () => mocks.user,
}));

vi.mock("@/lib/api/approvals/list", () => ({
  readProfileRole: async () => mocks.role,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    mocks.notFound();
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import AssistantPage from "./page";
import AssistantClient from "./assistant-client";

const SCRIPT = "<script>alert(1)</script>";
const CONV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  mocks.user = null;
  mocks.role = "other";
  mocks.redirect.mockClear();
  mocks.notFound.mockClear();
});

describe("assistant page", () => {
  it("redirects a signed-out visitor and hides the page from other roles", async () => {
    await expect(AssistantPage()).rejects.toThrow("REDIRECT /login?next=/assistant");
    expect(mocks.redirect).toHaveBeenCalledWith("/login?next=/assistant");
    mocks.user = { id: "11111111-1111-4111-8111-111111111111" };
    for (const role of ["other", "error"] as const) {
      mocks.role = role;
      mocks.notFound.mockClear();
      await expect(AssistantPage()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(mocks.notFound).toHaveBeenCalled();
    }
  });

  it("renders Tay for a brand", async () => {
    mocks.user = { id: "11111111-1111-4111-8111-111111111111" };
    mocks.role = "brand";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ conversations: [] }) }))
    );
    render((await AssistantPage()) as ReactElement);
    expect(screen.getByRole("heading", { name: "Tay" })).toBeInTheDocument();
  });
});

describe("AssistantClient", () => {
  it("shows the empty state and renders model text literally", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/assistant") return { ok: true, json: async () => ({ conversations: [] }) };
        return {
          ok: true,
          json: async () => ({
            messages: [
              {
                id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
                role: "assistant",
                content: { text: `${SCRIPT} https://evil.example/phish` },
                action_ids: ["cccccccc-cccc-4ccc-8ccc-ccccccccccc1"],
                created_at: "2026-11-10T00:00:00.000Z",
              },
            ],
          }),
        };
      })
    );
    const view = render(<AssistantClient />);
    expect(
      await screen.findByText(
        "Ask Tay for a campaign plan, a show lookup, or an outreach draft. Anything that changes your account waits for your approval."
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    await waitFor(() => expect(screen.queryByText(/Ask Tay for a campaign plan/)).not.toBeNull());
    view.rerender(<AssistantClient />);
  });

  it("shows a script tag as text and links only to the approval inbox", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url) === "/api/assistant") {
          return {
            ok: true,
            json: async () => ({
              conversations: [
                {
                  id: CONV,
                  title: "Quarter test",
                  created_at: "2026-11-10T00:00:00.000Z",
                  updated_at: "2026-11-10T00:00:00.000Z",
                },
              ],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            conversation: { id: CONV, title: "Quarter test" },
            messages: [
              {
                id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
                role: "assistant",
                content: { text: `${SCRIPT} https://evil.example/phish` },
                action_ids: ["cccccccc-cccc-4ccc-8ccc-ccccccccccc1"],
                created_at: "2026-11-10T00:00:00.000Z",
              },
            ],
          }),
        };
      })
    );
    const view = render(<AssistantClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Quarter test" }));
    const literal = await screen.findByText(`${SCRIPT} https://evil.example/phish`);
    expect(literal).toBeInTheDocument();
    expect(view.container.querySelector("script")).toBeNull();
    expect(view.container.querySelector('a[href*="evil.example"]')).toBeNull();
    expect(screen.getByRole("link", { name: "Review actions" })).toHaveAttribute(
      "href",
      "/settings/agent-actions"
    );
    expect(screen.getByText("Waiting for your approval.")).toBeInTheDocument();
    expect(view.container.innerHTML).not.toContain("dangerouslySetInnerHTML");
  });
});
