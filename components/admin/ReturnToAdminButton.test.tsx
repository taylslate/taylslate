// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import ReturnToAdminButton from "./ReturnToAdminButton";

const mockAssign = vi.fn();

beforeEach(() => {
  mockAssign.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign: mockAssign },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReturnToAdminButton", () => {
  it("is a hairline ink button, not orange, and still redeems via POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "/callback?token_hash=abc" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<ReturnToAdminButton />);
    const btn = screen.getByRole("button", { name: "Return to admin" });

    expect(btn.className).toContain("border-[var(--ts-hairline)]");
    expect(btn.className).toContain("text-[var(--ts-ink)]");
    expect(container.innerHTML).not.toMatch(/--brand-orange|text-white|bg-white/);

    fireEvent.click(btn);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/return-to-admin", {
        method: "POST",
      });
    });
    await waitFor(() => {
      expect(mockAssign).toHaveBeenCalledWith("/callback?token_hash=abc");
    });
  });
});
