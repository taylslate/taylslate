// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { mockPush, mockReplace, mockRefresh, getUser } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockReplace: vi.fn(),
  mockRefresh: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: mockRefresh }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/image", () => ({
  default: () => null,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser } }),
}));

import ShowSignupPage from "./page";

const fetchMock = vi.fn();

beforeEach(() => {
  mockPush.mockReset();
  mockReplace.mockReset();
  mockRefresh.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ShowSignupPage", () => {
  it("renders the sign-up copy and the email code form for a signed-out visitor", async () => {
    render(<ShowSignupPage />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Sign up as a show or creator" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("We'll email you a 6-digit code. No password."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send code" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("sends a signed-in visitor to the dashboard", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    render(<ShowSignupPage />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByRole("button", { name: "Send code" })).toBeNull();
  });

  it("requests a code with intent show_signup and next /onboarding/show", async () => {
    render(<ShowSignupPage />);
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText("Code");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/login/otp");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      email: "new@example.com",
      next: "/onboarding/show",
      intent: "show_signup",
    });
    expect(
      screen.getByText("We emailed you a 6-digit code. Enter it below."),
    ).toBeInTheDocument();
  });

  it("follows the returned next after the code verifies", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, next: "/onboarding/show" }),
      });
    render(<ShowSignupPage />);
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    fireEvent.change(await screen.findByLabelText("Code"), {
      target: { value: "482913" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/onboarding/show"));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("never renders DB text from an error response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "secret-db-text" }),
    });
    const { container } = render(<ShowSignupPage />);
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByRole("alert");
    expect(container.textContent).not.toContain("secret-db-text");
  });
});
