// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { mockPush, mockRefresh, signInWithPassword, mockReset, tokenState } =
  vi.hoisted(() => ({
    mockPush: vi.fn(),
    mockRefresh: vi.fn(),
    signInWithPassword: vi.fn(),
    mockReset: vi.fn(),
    // The stubbed Turnstile widget issues this token on mount. Set to null to
    // simulate the disabled (no site key / local dev) path.
    tokenState: { current: "tok-test" as string | null },
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword } }),
}));
vi.mock("@/components/auth/turnstile-widget", async () => {
  const { forwardRef, useEffect, useImperativeHandle } = await import("react");
  return {
    TurnstileWidget: forwardRef(function Stub(
      { onVerify }: { onVerify: (t: string) => void },
      ref: React.Ref<{ reset: () => void }>,
    ) {
      useImperativeHandle(ref, () => ({ reset: mockReset }), []);
      useEffect(() => {
        if (tokenState.current) onVerify(tokenState.current);
      }, [onVerify]);
      return null;
    }),
  };
});

import LoginPage from "./page";

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "jane@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "hunter2secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: /log in/i }));
}

beforeEach(() => {
  signInWithPassword.mockReset();
  mockPush.mockReset();
  mockRefresh.mockReset();
  mockReset.mockReset();
  tokenState.current = "tok-test";
});
afterEach(() => cleanup());

describe("LoginPage", () => {
  it("threads the Turnstile captchaToken into signInWithPassword when present", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    render(<LoginPage />);
    fillAndSubmit();
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalled());
    expect(signInWithPassword.mock.calls[0][0].options.captchaToken).toBe(
      "tok-test",
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"));
  });

  it("omits captchaToken when the widget is disabled (no site key / local dev)", async () => {
    tokenState.current = null;
    signInWithPassword.mockResolvedValue({ error: null });
    render(<LoginPage />);
    fillAndSubmit();
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalled());
    expect(signInWithPassword.mock.calls[0][0].options).not.toHaveProperty(
      "captchaToken",
    );
  });

  it("resets the widget and shows friendly retry copy on a captcha rejection", async () => {
    signInWithPassword.mockResolvedValue({
      error: { message: "captcha verification process failed" },
    });
    render(<LoginPage />);
    fillAndSubmit();
    await screen.findByText(/couldn't verify you're human/i);
    expect(
      screen.queryByText(/captcha verification process failed/i),
    ).toBeNull();
    expect(mockReset).toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("passes a real credential error through unchanged", async () => {
    signInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });
    render(<LoginPage />);
    fillAndSubmit();
    await screen.findByText("Invalid login credentials");
    expect(mockPush).not.toHaveBeenCalled();
  });
});
