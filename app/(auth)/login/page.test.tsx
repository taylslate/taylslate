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
  it("is paper + slate, magic-link first, no clap, no AI-powered copy", () => {
    const { container } = render(<LoginPage />);
    expect(container.querySelector(".marketing-page")).not.toBeNull();
    expect(container.querySelector('img[src="/mark.png"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "taylslate" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Log in" }),
    ).toBeInTheDocument();
    expect(screen.getByText("We'll email you a link.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send link" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Use a password instead" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByText(/AI-powered/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /switch to/i })).toBeNull();
    expect(container.textContent).not.toMatch(/AI-powered/i);
  });

  it("sends a magic link for a valid email and shows check-your-email", async () => {
    render(<LoginPage />);
    fillEmail("jane@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login/magic",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.email).toBe("jane@example.com");
    expect(
      await screen.findByRole("heading", { name: "Check your email" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("If that address has an account, the link is on its way."),
    ).toBeInTheDocument();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("stays on login and points unknown emails to signup", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "no_account" }),
    });
    render(<LoginPage />);
    fillEmail("nobody@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No account for that email. Sign up instead.",
    );
    expect(
      screen.getByRole("link", { name: /sign up instead/i }),
    ).toHaveAttribute("href", "/signup");
    expect(
      screen.getByRole("heading", { level: 1, name: "Log in" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Check your email" }),
    ).toBeNull();
  });

  it("rejects an empty email without requesting a magic link", async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "Send link" }));
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
