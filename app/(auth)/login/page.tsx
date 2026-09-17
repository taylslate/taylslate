"use client";

import { Suspense, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { tokens } from "@/lib/brand/tokens";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";
import {
  TurnstileWidget,
  type TurnstileHandle,
} from "@/components/auth/turnstile-widget";
import {
  withCaptchaToken,
  isCaptchaError,
  CAPTCHA_RETRY_MESSAGE,
} from "@/lib/auth/turnstile";
import {
  isValidLoginEmail,
  normalizeLoginEmail,
  LOGIN_MAGIC_NO_ACCOUNT,
} from "@/lib/auth/login-magic";

const inputClass =
  "w-full border border-[var(--ts-ink-on-paper)]/15 bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:outline-none";
const labelClass =
  "mb-1.5 block text-sm font-medium text-[var(--ts-ink-on-paper)]";
const primaryBtnClass =
  "w-full bg-[var(--ts-ink-on-paper)] py-2.5 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"magic" | "password" | null>(
    null,
  );
  const [sent, setSent] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | undefined>();
  const turnstileRef = useRef<TurnstileHandle>(null);

  const handleMagicSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const normalized = normalizeLoginEmail(email);
    if (!normalized || !isValidLoginEmail(normalized)) {
      setError("Enter your email.");
      return;
    }

    setSubmitting("magic");
    try {
      const res = await fetch("/api/auth/login/magic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: normalized,
          next: searchParams.get("next"),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        turnstileRef.current?.reset();
        setCaptchaToken(undefined);
        if (data?.error === LOGIN_MAGIC_NO_ACCOUNT) {
          setError(LOGIN_MAGIC_NO_ACCOUNT);
          return;
        }
        setError(
          data?.error === "email required" || data?.error === "invalid email"
            ? "Enter your email."
            : "Could not send the link. Try again.",
        );
        return;
      }
      setSent(true);
    } catch {
      turnstileRef.current?.reset();
      setCaptchaToken(undefined);
      setError("Could not send the link. Try again.");
    } finally {
      setSubmitting(null);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting("password");

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: withCaptchaToken({}, captchaToken),
    });

    if (signInError) {
      turnstileRef.current?.reset();
      setCaptchaToken(undefined);
      setError(
        isCaptchaError(signInError.message)
          ? CAPTCHA_RETRY_MESSAGE
          : signInError.message,
      );
      setSubmitting(null);
      return;
    }

    const next = searchParams.get("next") || "/dashboard";
    router.push(next);
    router.refresh();
  };

  if (sent) {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
          If that address has an account, the link is on its way.
        </p>
        <button
          type="button"
          onClick={() => {
            setSent(false);
            setError(null);
          }}
          className="mt-8 text-sm text-[var(--ts-accent)] hover:underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
      </div>

      {error === LOGIN_MAGIC_NO_ACCOUNT ? (
        <p className="mb-4 text-sm text-[var(--ts-ink-on-paper)]" role="alert">
          No account for that email.{" "}
          <Link href="/signup" className="text-[var(--ts-accent)] hover:underline">
            Sign up instead.
          </Link>
        </p>
      ) : error ? (
        <p className="mb-4 text-sm text-[var(--ts-ink-on-paper)]" role="alert">
          {error}
        </p>
      ) : null}

      <form onSubmit={handleMagicSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className={labelClass}>
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className={inputClass}
            style={{ borderRadius: tokens.radius }}
            placeholder="you@example.com"
          />
        </div>

        <TurnstileWidget
          ref={turnstileRef}
          onVerify={setCaptchaToken}
          onExpire={() => setCaptchaToken(undefined)}
          onError={() => setCaptchaToken(undefined)}
        />

        <button
          type="submit"
          disabled={submitting !== null}
          className={primaryBtnClass}
          style={{ borderRadius: tokens.radius }}
        >
          {submitting === "magic" ? "Sending…" : "Send magic link"}
        </button>
      </form>

      <div className="mt-6">
        <button
          type="button"
          aria-expanded={usePassword}
          onClick={() => {
            setUsePassword((open) => !open);
            setError(null);
          }}
          className="text-sm text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
        >
          Use a password instead
        </button>

        {usePassword ? (
          <form onSubmit={handlePasswordSubmit} className="mt-4 space-y-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-[var(--ts-accent)] hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className={inputClass}
                style={{ borderRadius: tokens.radius }}
                placeholder="Your password"
              />
            </div>
            <button
              type="submit"
              disabled={submitting !== null}
              className="w-full border border-[var(--ts-ink-on-paper)]/20 py-2.5 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-ink-on-paper)]/5 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ borderRadius: tokens.radius }}
            >
              {submitting === "password" ? "Logging in..." : "Log in"}
            </button>
          </form>
        ) : null}
      </div>

      <p className="mt-8 text-sm text-[var(--ts-ink-muted-on-paper)]">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-[var(--ts-accent)] hover:underline">
          Sign up
        </Link>
      </p>
    </>
  );
}

function LoginShell({ children }: { children: React.ReactNode }) {
  return (
    <MarketingChrome
      actions={
        <Link
          href="/signup"
          className="hidden bg-[var(--ts-ink-on-paper)] px-3.5 py-1.5 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 sm:inline-flex"
          style={{ borderRadius: tokens.radius }}
        >
          Get started
        </Link>
      }
    >
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </MarketingChrome>
  );
}

export default function LoginPage() {
  return (
    <LoginShell>
      <Suspense
        fallback={
          <p className="text-center text-sm text-[var(--ts-ink-muted-on-paper)]">
            Loading...
          </p>
        }
      >
        <LoginForm />
      </Suspense>
    </LoginShell>
  );
}
