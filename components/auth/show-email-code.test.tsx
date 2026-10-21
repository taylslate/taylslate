// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ShowEmailCode } from "./show-email-code";

const fetchMock = vi.fn();
const onVerified = vi.fn();

function renderForm() {
  return render(<ShowEmailCode onVerified={onVerified} />);
}

beforeEach(() => {
  fetchMock.mockReset();
  onVerified.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ShowEmailCode", () => {
  it("requests a code, then verifies it", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, next: "/dashboard" }),
      });
    renderForm();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "host@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByLabelText("Code")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/login/otp");

    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "482913" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith("/dashboard"));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/login/otp/verify");
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(body).toMatchObject({ email: "host@example.com", code: "482913" });
  });

  it("shows an expired code and clears it when the code changes", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: "expired" }),
      });
    renderForm();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "host@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText("Code");
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code has expired. Request a new one.",
    );
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "222222" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps resend disabled for 60 seconds", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    renderForm();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "host@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    const resend = await screen.findByRole("button", { name: "Resend code in 60s" });
    expect(resend).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(59_000);
    });
    expect(screen.getByRole("button", { name: "Resend code in 1s" })).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  });

  it("points an unknown email at signup and stays on the email step", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "no_account" }),
    });
    renderForm();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "brand@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No account for that email.");
    expect(screen.getByRole("link", { name: "Sign up instead." })).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(screen.queryByText(/magic link/i)).toBeNull();
    expect(screen.queryByLabelText("Code")).toBeNull();
  });
});
