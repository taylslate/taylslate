"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { tokens } from "@/lib/brand/tokens";
import { inputClass, labelClass, primaryBtnClass } from "@/components/auth/auth-shell";
import { isValidLoginEmail, normalizeLoginEmail } from "@/lib/auth/login-magic";
import {
  isSixDigitCode,
  LOGIN_OTP_NO_ACCOUNT,
  LOGIN_OTP_RESEND_SEC,
  LOGIN_OTP_RESEND_WAIT,
  loginOtpErrorMessage,
  normalizeLoginOtp,
} from "@/lib/auth/login-otp";

interface ShowEmailCodeProps {
  defaultEmail?: string;
  /** Controlled email. Login shares this value with the password form. */
  emailValue?: string;
  onEmailChange?: (email: string) => void;
  /** Pitch token. Present only on show setup, where a new show may be created. */
  outreachToken?: string;
  nextPath?: string | null;
  onVerified: (nextPath: string) => void;
}

export function ShowEmailCode({
  defaultEmail = "",
  emailValue,
  onEmailChange,
  outreachToken,
  nextPath,
  onVerified,
}: ShowEmailCodeProps) {
  const [uncontrolledEmail, setUncontrolledEmail] = useState(defaultEmail);
  const email = emailValue ?? uncontrolledEmail;
  const setEmail = (value: string) => {
    onEmailChange?.(value);
    if (emailValue === undefined) setUncontrolledEmail(value);
  };
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"send" | "verify" | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const cooling = cooldown > 0;
  useEffect(() => {
    if (!cooling) return;
    const id = window.setInterval(() => {
      setCooldown((current) => (current <= 1 ? 0 : current - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooling]);

  const requestCode = async () => {
    setError(null);
    const normalized = normalizeLoginEmail(email);
    if (!normalized || !isValidLoginEmail(normalized)) {
      setError("Enter your email.");
      return;
    }
    setSubmitting("send");
    try {
      const res = await fetch("/api/auth/login/otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: normalized,
          outreach_token: outreachToken,
          next: nextPath,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        retry_after_sec?: number;
      } | null;
      if (res.status === 429) {
        const wait =
          typeof data?.retry_after_sec === "number" && data.retry_after_sec > 0
            ? data.retry_after_sec
            : LOGIN_OTP_RESEND_SEC;
        setStep("code");
        setCooldown(wait);
        setError(loginOtpErrorMessage(LOGIN_OTP_RESEND_WAIT, "request"));
        return;
      }
      if (!res.ok) {
        setError(loginOtpErrorMessage(data?.error, "request"));
        return;
      }
      setStep("code");
      setCode("");
      setError(null);
      setCooldown(LOGIN_OTP_RESEND_SEC);
    } catch {
      setError(loginOtpErrorMessage(undefined, "request"));
    } finally {
      setSubmitting(null);
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const token = normalizeLoginOtp(code);
    if (!isSixDigitCode(token)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setSubmitting("verify");
    try {
      const res = await fetch("/api/auth/login/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: normalizeLoginEmail(email),
          code: token,
          next: nextPath,
          outreach_token: outreachToken,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        next?: string;
      } | null;
      if (!res.ok) {
        setError(loginOtpErrorMessage(data?.error, "verify"));
        return;
      }
      onVerified(data?.next || "/dashboard");
    } catch {
      setError(loginOtpErrorMessage(undefined, "verify"));
    } finally {
      setSubmitting(null);
    }
  };

  const noAccount =
    !outreachToken && error === loginOtpErrorMessage(LOGIN_OTP_NO_ACCOUNT, "request");

  return (
    <div>
      {error ? (
        <p className="mb-4 text-sm text-[var(--ts-ink-on-paper)]" role="alert">
          {noAccount ? (
            <>
              No account for that email.{" "}
              <Link href="/signup" className="text-[var(--ts-accent-text)] hover:underline">
                Sign up instead.
              </Link>
            </>
          ) : (
            error
          )}
        </p>
      ) : null}

      {step === "email" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void requestCode();
          }}
          className="space-y-4"
        >
          <div>
            <label htmlFor="show-otp-email" className={labelClass}>
              Email
            </label>
            <input
              id="show-otp-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              autoComplete="email"
              className={inputClass}
              style={{ borderRadius: tokens.radius }}
              placeholder="you@example.com"
            />
          </div>
          <button
            type="submit"
            disabled={submitting !== null}
            className={primaryBtnClass}
            style={{ borderRadius: tokens.radius }}
          >
            {submitting === "send" ? "Sending…" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="space-y-4">
          <p className="text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
            We sent a 6-digit code to <span className="text-[var(--ts-ink-on-paper)]">{email}</span>.
          </p>
          <div>
            <label htmlFor="show-otp-code" className={labelClass}>
              Code
            </label>
            <input
              id="show-otp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                setError(null);
              }}
              className={inputClass}
              style={{ borderRadius: tokens.radius }}
              placeholder="6-digit code"
            />
          </div>
          <button
            type="submit"
            disabled={submitting !== null}
            className={primaryBtnClass}
            style={{ borderRadius: tokens.radius }}
          >
            {submitting === "verify" ? "Checking…" : "Sign in"}
          </button>
          <button
            type="button"
            onClick={() => void requestCode()}
            disabled={submitting !== null || cooldown > 0}
            className="w-full border border-[var(--ts-ink-on-paper)]/20 py-2.5 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-ink-on-paper)]/5 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ borderRadius: tokens.radius }}
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("email");
              setCode("");
              setError(null);
              setCooldown(0);
            }}
            className="w-full text-sm text-[var(--ts-accent-text)] hover:underline"
          >
            Use a different email
          </button>
        </form>
      )}
    </div>
  );
}
