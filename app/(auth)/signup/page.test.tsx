// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { mockPush, mockRefresh, signUp, mockReset, tokenState } = vi.hoisted(
  () => ({
    mockPush: vi.fn(),
    mockRefresh: vi.fn(),
    signUp: vi.fn(),
    mockReset: vi.fn(),
    // The stubbed Turnstile widget issues this token on mount. Set to null to
    // simulate the disabled (no site key / local dev) path.
    tokenState: { current: "tok-test" as string | null },
  }),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signUp } }),
}));
// Stub the Turnstile widget: issue the token on mount (when enabled) and expose
// reset() via the ref so we can assert the single-use reset-on-failure logic.
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

import SignupPage from "./page";

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("Full name"), {
    target: { value: "Jane Smith" },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "jane@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "password1234" },
  });
  fireEvent.click(screen.getByRole("button", { name: /create account/i }));
}

const NEW_SIGNUP = {
  data: { user: { identities: [{ id: "i1" }] }, session: null },
  error: null,
};
const EXISTING_EMAIL_DECOY = {
  data: { user: { identities: [] }, session: null },
  error: null,
};

beforeEach(() => {
  signUp.mockReset();
  mockPush.mockReset();
  mockRefresh.mockReset();
  mockReset.mockReset();
  tokenState.current = "tok-test";
});
afterEach(() => cleanup());

describe("SignupPage", () => {
  it("renders identical check-email copy for a new signup and the existing-email decoy (no account-existence leak)", async () => {
    signUp.mockResolvedValue(NEW_SIGNUP);
    const a = render(<SignupPage />);
    fillAndSubmit();
    await screen.findByText("Check your email");
    const textNew = a.container.textContent;
    expect(mockPush).not.toHaveBeenCalled();
    cleanup();

    signUp.mockResolvedValue(EXISTING_EMAIL_DECOY);
    const b = render(<SignupPage />);
    fillAndSubmit();
    await screen.findByText("Check your email");
    const textDecoy = b.container.textContent;
    expect(mockPush).not.toHaveBeenCalled();

    // The whole point: the two outcomes must be indistinguishable to the user.
    expect(textDecoy).toBe(textNew);
    expect(textNew).toMatch(/is new to Taylslate/i);
  });

  it("passes emailRedirectTo → /callback?next=/onboarding to signUp", async () => {
    signUp.mockResolvedValue(NEW_SIGNUP);
    render(<SignupPage />);
    fillAndSubmit();
    await waitFor(() => expect(signUp).toHaveBeenCalled());
    const opts = signUp.mock.calls[0][0].options;
    expect(opts.emailRedirectTo).toMatch(/\/callback\?next=\/onboarding$/);
    expect(opts.data).toEqual({ full_name: "Jane Smith" });
  });

  it("redirects to /onboarding (no check-email screen) when a session is issued", async () => {
    signUp.mockResolvedValue({
      data: { user: { identities: [{ id: "i1" }] }, session: { access_token: "t" } },
      error: null,
    });
    render(<SignupPage />);
    fillAndSubmit();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/onboarding"));
    expect(screen.queryByText("Check your email")).toBeNull();
  });

  it("surfaces the error and stays on the form", async () => {
    signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Password should be at least 8 characters." },
    });
    render(<SignupPage />);
    fillAndSubmit();
    await screen.findByText("Password should be at least 8 characters.");
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByText("Check your email")).toBeNull();
  });

  it("threads the Turnstile captchaToken into signUp when a token is present", async () => {
    signUp.mockResolvedValue(NEW_SIGNUP);
    render(<SignupPage />);
    fillAndSubmit();
    await waitFor(() => expect(signUp).toHaveBeenCalled());
    expect(signUp.mock.calls[0][0].options.captchaToken).toBe("tok-test");
  });

  it("omits captchaToken when the widget is disabled (no site key / local dev)", async () => {
    tokenState.current = null; // widget issues no token
    signUp.mockResolvedValue(NEW_SIGNUP);
    render(<SignupPage />);
    fillAndSubmit();
    await waitFor(() => expect(signUp).toHaveBeenCalled());
    expect(signUp.mock.calls[0][0].options).not.toHaveProperty("captchaToken");
  });

  it("resets the widget and shows friendly retry copy on a captcha rejection", async () => {
    signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "captcha verification process failed" },
    });
    render(<SignupPage />);
    fillAndSubmit();
    await screen.findByText(/couldn't verify you're human/i);
    // Raw Supabase captcha error is never shown; widget is reset for a retry.
    expect(screen.queryByText(/captcha verification process failed/i)).toBeNull();
    expect(mockReset).toHaveBeenCalled();
  });
});
