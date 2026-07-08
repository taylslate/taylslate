"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  TurnstileWidget,
  type TurnstileHandle,
} from "@/components/auth/turnstile-widget";
import {
  withCaptchaToken,
  isCaptchaError,
  CAPTCHA_RETRY_MESSAGE,
} from "@/lib/auth/turnstile";
import { classifySignupOutcome } from "./signup-outcome";

// Resolve the site origin the confirmation link should return to. Mirrors the
// server-side helper in app/api/auth/magic/route.ts: prefer the configured
// site URL (the www host in prod), fall back to the live origin, trim any
// trailing slash so `${origin}/callback` never doubles up.
function resolveSiteOrigin(): string {
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  const origin =
    envOrigin || (typeof window !== "undefined" ? window.location.origin : "");
  return origin.replace(/\/$/, "");
}

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Set once the signup resolved to a "check your email" outcome (a genuine new
  // signup or the existing-email decoy — rendered identically to avoid leaking
  // account existence).
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  // Turnstile token (undefined until the widget solves; stays undefined in
  // local dev where the widget is disabled). Threaded into signUp when present.
  const [captchaToken, setCaptchaToken] = useState<string | undefined>();
  const turnstileRef = useRef<TurnstileHandle>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const result = await supabase.auth.signUp({
      email,
      password,
      options: withCaptchaToken(
        {
          data: { full_name: fullName },
          emailRedirectTo: `${resolveSiteOrigin()}/callback?next=/onboarding`,
        },
        captchaToken,
      ),
    });

    setLoading(false);
    const outcome = classifySignupOutcome(result);

    if (outcome.kind === "error") {
      // The token is single-use and was consumed by this attempt; reset the
      // widget so a retry gets a fresh one, and show friendly copy on a
      // captcha rejection instead of the raw Supabase error.
      turnstileRef.current?.reset();
      setCaptchaToken(undefined);
      setError(
        isCaptchaError(outcome.message)
          ? CAPTCHA_RETRY_MESSAGE
          : outcome.message,
      );
      return;
    }
    if (outcome.kind === "session") {
      // Confirm-email off / already-confirmed edge: signed in already, skip
      // the check-email screen and go straight to onboarding.
      router.push("/onboarding");
      router.refresh();
      return;
    }
    // check-email | obfuscated → same neutral screen.
    setAwaitingConfirmation(true);
  };

  if (awaitingConfirmation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--brand-surface)] px-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-14 h-14 rounded-2xl bg-[var(--brand-success)]/10 flex items-center justify-center mx-auto mb-5">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--brand-success)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[var(--brand-text)] mb-2">
            Check your email
          </h1>
          <p className="text-sm text-[var(--brand-text-secondary)] mb-6">
            If <strong>{email}</strong> is new to Taylslate, a confirmation link
            is on its way. Click it to activate your account.
          </p>
          <Link
            href="/login"
            className="text-sm text-[var(--brand-blue)] font-medium hover:underline"
          >
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--brand-surface)] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[var(--brand-text)]">
            Create your account
          </h1>
          <p className="text-sm text-[var(--brand-text-secondary)] mt-2">
            Get started with Taylslate in minutes.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-[var(--brand-surface-elevated)] border border-[var(--brand-border)] rounded-2xl p-6 space-y-4"
        >
          {error && (
            <div className="p-3 rounded-lg bg-[var(--brand-error)]/10 text-[var(--brand-error)] text-sm">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="fullName"
              className="block text-sm font-medium text-[var(--brand-text)] mb-1.5"
            >
              Full name
            </label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-[var(--brand-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/40 focus:border-[var(--brand-blue)]"
              placeholder="Jane Smith"
            />
          </div>

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-[var(--brand-text)] mb-1.5"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-[var(--brand-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/40 focus:border-[var(--brand-blue)]"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-[var(--brand-text)] mb-1.5"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-[var(--brand-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/40 focus:border-[var(--brand-blue)]"
              placeholder="At least 8 characters"
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
            className="w-full py-2.5 bg-[var(--brand-blue)] text-white rounded-xl font-semibold hover:bg-[var(--brand-blue-light)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="text-center text-sm text-[var(--brand-text-secondary)] mt-6">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-[var(--brand-blue)] font-medium hover:underline"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
