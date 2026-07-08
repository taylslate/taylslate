// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { mockPush, mockRefresh, updateUser } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { updateUser } }),
}));

import ResetPasswordForm from "./reset-password-form";

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
  updateUser.mockReset();
});
afterEach(() => cleanup());

describe("ResetPasswordForm", () => {
  it("updates the password and redirects to /dashboard", async () => {
    updateUser.mockResolvedValue({ error: null });
    render(<ResetPasswordForm />);
    fill("password1234", "password1234");
    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith({ password: "password1234" })
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"));
  });

  it("rejects mismatched passwords without calling updateUser", async () => {
    render(<ResetPasswordForm />);
    fill("password1234", "different9999");
    await screen.findByText(/do not match/i);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("rejects a short password without calling updateUser", async () => {
    render(<ResetPasswordForm />);
    fill("short", "short");
    await screen.findByText(/at least 8 characters/i);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("surfaces an updateUser error and does not redirect", async () => {
    updateUser.mockResolvedValue({ error: { message: "Auth session missing!" } });
    render(<ResetPasswordForm />);
    fill("password1234", "password1234");
    await screen.findByText("Auth session missing!");
    expect(mockPush).not.toHaveBeenCalled();
  });
});
