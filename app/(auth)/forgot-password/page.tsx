"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { tokens } from "@/lib/brand/tokens";
import {
  AuthShell,
  inputClass,
  labelClass,
  primaryBtnClass,
} from "@/components/auth/auth-shell";
import {
  TurnstileWidget,
  type TurnstileHandle,
} from "@/components/auth/turnstile-widget";
import {
  withCaptchaToken,
  isCaptchaError,
  CAPTCHA_RETRY_MESSAGE,
} from "@/lib/auth/turnstile";

// Resolve the site origin the reset link should return to. Mirrors the signup
// page and the server helper in app/api/auth/magic/route.ts.
function resolveSiteOrigin(): string {
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  const origin =
    envOrigin || (typeof window !== "undefined" ? window.location.origin : "");
  return origin.replace(/\/$/, "");
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  // Turnstile token (undefined until solved / in local dev). Threaded into
  // resetPasswordForEmail when present.
  const [captchaToken, setCaptchaToken] = useState<string | undefined>();
  const turnstileRef = useRef<TurnstileHandle>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(
      email,
      withCaptchaToken(
        { redirectTo: `${resolveSiteOrigin()}/callback?next=/reset-password` },
        captchaToken,
      ),
    );

    setLoading(false);
    if (error) {
      // Reset the single-use token so a retry gets a fresh one; show friendly
      // copy on a captcha rejection instead of the raw error.
      turnstileRef.current?.reset();
      setCaptchaToken(undefined);
      setError(
        isCaptchaError(error.message) ? CAPTCHA_RETRY_MESSAGE : error.message,
      );
      return;
    }
    // Supabase returns success whether or not the address has an account, and
    // we show the same neutral confirmation either way — account existence
    // must never leak (same principle as the signup flow).
    setSent(true);
  };

  if (sent) {
    return (
      <AuthShell>
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Check your email
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
            If <strong>{email}</strong> has a Taylslate account, a password reset
            link is on its way.
          </p>
          <Link
            href="/login"
            className="mt-8 inline-block text-sm text-[var(--ts-accent)] hover:underline"
          >
            Back to login
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Reset your password
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>

      {error ? (
        <p className="mb-4 text-sm text-[var(--ts-ink-on-paper)]" role="alert">
          {error}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className={labelClass}>
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
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
          disabled={loading}
          className={primaryBtnClass}
          style={{ borderRadius: tokens.radius }}
        >
          {loading ? "Sending..." : "Send reset link"}
        </button>
      </form>

      <p className="mt-8 text-sm text-[var(--ts-ink-muted-on-paper)]">
        Remember your password?{" "}
        <Link href="/login" className="text-[var(--ts-accent)] hover:underline">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
