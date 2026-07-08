// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { resetPasswordForEmail, mockReset, tokenState } = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  mockReset: vi.fn(),
  // The stubbed Turnstile widget issues this token on mount. Set to null to
  // simulate the disabled (no site key / local dev) path.
  tokenState: { current: "tok-test" as string | null },
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { resetPasswordForEmail } }),
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

import ForgotPasswordPage from "./page";

function submit(email: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
}

beforeEach(() => {
  resetPasswordForEmail.mockReset();
  mockReset.mockReset();
  tokenState.current = "tok-test";
});
afterEach(() => cleanup());

describe("ForgotPasswordPage", () => {
  it("sends the reset via /callback?next=/reset-password and shows a neutral, non-leaking confirmation", async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null });
    render(<ForgotPasswordPage />);
    submit("jane@example.com");

    await screen.findByText("Check your email");
    expect(resetPasswordForEmail).toHaveBeenCalledWith(
      "jane@example.com",
      expect.objectContaining({
        redirectTo: expect.stringMatching(/\/callback\?next=\/reset-password$/),
      })
    );
    // Copy must not confirm the address exists.
    expect(screen.getByText(/has a Taylslate account/i)).toBeInTheDocument();
  });

  it("surfaces an error (e.g. rate limit) instead of the confirmation", async () => {
    resetPasswordForEmail.mockResolvedValue({
      error: { message: "Email rate limit exceeded" },
    });
    render(<ForgotPasswordPage />);
    submit("jane@example.com");

    await screen.findByText("Email rate limit exceeded");
    expect(screen.queryByText("Check your email")).toBeNull();
  });

  it("threads the Turnstile captchaToken when a token is present", async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null });
    render(<ForgotPasswordPage />);
    submit("jane@example.com");

    await screen.findByText("Check your email");
    expect(resetPasswordForEmail.mock.calls[0][1].captchaToken).toBe("tok-test");
  });

  it("omits captchaToken when the widget is disabled (no site key / local dev)", async () => {
    tokenState.current = null;
    resetPasswordForEmail.mockResolvedValue({ error: null });
    render(<ForgotPasswordPage />);
    submit("jane@example.com");

    await screen.findByText("Check your email");
    expect(resetPasswordForEmail.mock.calls[0][1]).not.toHaveProperty(
      "captchaToken",
    );
  });

  it("resets the widget and shows friendly retry copy on a captcha rejection", async () => {
    resetPasswordForEmail.mockResolvedValue({
      error: { message: "captcha protection: request disallowed" },
    });
    render(<ForgotPasswordPage />);
    submit("jane@example.com");

    await screen.findByText(/couldn't verify you're human/i);
    expect(screen.queryByText("Check your email")).toBeNull();
    expect(mockReset).toHaveBeenCalled();
  });
});
