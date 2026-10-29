// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
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
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    width,
    height,
    className,
  }: {
    src: string;
    alt: string;
    width: number;
    height: number;
    className?: string;
  }) => (
    <img src={src} alt={alt} width={width} height={height} className={className} />
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

const fetchMock = vi.fn();

function fillEmail(value = "jane@example.com") {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value },
  });
}

const SENT_NOTICE =
  "If an account exists for this email, we sent a 6-digit code. New here? Sign up.";

async function expectSameSentNotice() {
  const lead = await screen.findByText(
    /If an account exists for this email, we sent a 6-digit code\. New here\?/,
  );
  const notice = lead.closest("p");
  if (!notice) throw new Error("missing sent notice");
  expect(notice.textContent?.replace(/\s+/g, " ").trim()).toBe(SENT_NOTICE);
  expect(within(notice).getByRole("link", { name: "Sign up" })).toHaveAttribute(
    "href",
    "/signup",
  );
  expect(
    screen.queryByText("If there's an account for that email, we sent a 6-digit code."),
  ).toBeNull();
  expect(screen.queryByText(/No account for that email/i)).toBeNull();
  expect(screen.queryByRole("link", { name: /sign up instead/i })).toBeNull();
}

function expandPassword() {
  fireEvent.click(screen.getByRole("button", { name: /use a password instead/i }));
}

function fillAndSubmitPassword() {
  fillEmail();
  expandPassword();
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "hunter2secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));
}

beforeEach(() => {
  signInWithPassword.mockReset();
  mockPush.mockReset();
  mockRefresh.mockReset();
  mockReset.mockReset();
  tokenState.current = "tok-test";
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true }),
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LoginPage", () => {
  it("is paper + slate, code first, no clap, no AI-powered copy", () => {
    const { container } = render(<LoginPage />);
    expect(container.querySelector(".marketing-page")).not.toBeNull();
    expect(container.querySelector('img[src="/mark.png"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "taylslate" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Log in" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send code" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send magic link" })).toBeNull();
    expect(screen.queryByRole("link", { name: /magic link/i })).toBeNull();
    expect(screen.queryByText(/uses a brand login/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Use a password instead" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByText(/AI-powered/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /switch to/i })).toBeNull();
    expect(container.textContent).not.toMatch(/AI-powered/i);
  });

  it("sends a 6-digit code for a valid email", async () => {
    render(<LoginPage />);
    fillEmail("jane@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login/otp",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.email).toBe("jane@example.com");
    expect(await screen.findByLabelText("Code")).toBeInTheDocument();
    await expectSameSentNotice();
    expect(screen.getByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("shows the same notice for an unknown email", async () => {
    render(<LoginPage />);
    fillEmail("nobody@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await expectSameSentNotice();
    expect(screen.getByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    const signUpLinks = screen.getAllByRole("link", { name: "Sign up" });
    expect(signUpLinks.length).toBeGreaterThan(1);
    for (const link of signUpLinks) {
      expect(link).toHaveAttribute("href", "/signup");
    }
  });

  it("rejects an empty email without requesting a code", async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter your email.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("threads the Turnstile captchaToken into signInWithPassword when present", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    render(<LoginPage />);
    fillAndSubmitPassword();
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
    fillAndSubmitPassword();
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
    fillAndSubmitPassword();
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
    fillAndSubmitPassword();
    await screen.findByText("Invalid login credentials");
    expect(mockPush).not.toHaveBeenCalled();
  });
});
