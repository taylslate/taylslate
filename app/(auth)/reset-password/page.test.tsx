// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { mockPush, mockRefresh, getUser, updateUser } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser, updateUser } }),
}));

import ResetPasswordPage from "./page";

function fill(pw: string, confirm: string) {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: pw } });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: confirm },
  });
  fireEvent.click(screen.getByRole("button", { name: /update password/i }));
}

beforeEach(() => {
  mockPush.mockReset();
  mockRefresh.mockReset();
  getUser.mockReset();
  updateUser.mockReset();
});
afterEach(() => cleanup());

describe("ResetPasswordPage", () => {
  it("shows the expired state (no form) when there's no recovery session", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    render(<ResetPasswordPage />);
    await screen.findByText(/invalid or has expired/i);
    expect(screen.queryByLabelText("New password")).toBeNull();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("updates the password and redirects to /dashboard when a session exists", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    updateUser.mockResolvedValue({ error: null });
    render(<ResetPasswordPage />);
    await screen.findByLabelText("New password");
    fill("password1234", "password1234");
    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith({ password: "password1234" })
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"));
  });

  it("rejects mismatched passwords without calling updateUser", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    render(<ResetPasswordPage />);
    await screen.findByLabelText("New password");
    fill("password1234", "different9999");
    await screen.findByText(/do not match/i);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("rejects a short password without calling updateUser", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    render(<ResetPasswordPage />);
    await screen.findByLabelText("New password");
    fill("short", "short");
    await screen.findByText(/at least 8 characters/i);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("surfaces an updateUser error and does not redirect", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    updateUser.mockResolvedValue({ error: { message: "Auth session missing!" } });
    render(<ResetPasswordPage />);
    await screen.findByLabelText("New password");
    fill("password1234", "password1234");
    await screen.findByText("Auth session missing!");
    expect(mockPush).not.toHaveBeenCalled();
  });
});
