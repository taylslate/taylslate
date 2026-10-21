// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

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
    expect(
      screen.getByText("If there's an account for that email, we sent a 6-digit code."),
    ).toBeInTheDocument();
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

  it("does not say whether the email has an account", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    renderForm();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "brand@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(
      await screen.findByText("If there's an account for that email, we sent a 6-digit code."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No account for that email/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /sign up instead/i })).toBeNull();
    expect(screen.queryByText(/magic link/i)).toBeNull();
  });

  it("stays on the email step when the first send is rate limited", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: "hour_limit", retry_after_sec: 3500 }),
    });
    renderForm();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "host@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Try again later.",
    );
    expect(screen.queryByLabelText("Code")).toBeNull();
    expect(screen.queryByText(/Resend code in/)).toBeNull();
  });
});
