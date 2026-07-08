// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { cookieGet } = vi.hoisted(() => ({ cookieGet: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
// Sentinel — asserting the form component is (or isn't) rendered, without
// pulling its client-side supabase dependency into this gate test.
vi.mock("./reset-password-form", () => ({
  default: () => <div>RESET_FORM</div>,
}));

import ResetPasswordPage from "./page";

beforeEach(() => cookieGet.mockReset());
afterEach(() => cleanup());

describe("ResetPasswordPage (recovery gate)", () => {
  it("renders the form only when the recovery marker cookie is present", async () => {
    cookieGet.mockReturnValue({ value: "1" });
    render(await ResetPasswordPage());
    expect(screen.getByText("RESET_FORM")).toBeInTheDocument();
    expect(screen.queryByText(/invalid or has expired/i)).toBeNull();
  });

  it("renders the invalid/expired state (no form) when the recovery marker is absent", async () => {
    cookieGet.mockReturnValue(undefined);
    render(await ResetPasswordPage());
    expect(screen.queryByText("RESET_FORM")).toBeNull();
    expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument();
  });

  it("renders the invalid state for a stray non-'1' cookie value", async () => {
    cookieGet.mockReturnValue({ value: "0" });
    render(await ResetPasswordPage());
    expect(screen.queryByText("RESET_FORM")).toBeNull();
  });
});
