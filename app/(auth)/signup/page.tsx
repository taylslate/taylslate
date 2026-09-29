"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
      <AuthShell>
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Check your email
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
            If <strong>{email}</strong> is new to Taylslate, a confirmation link
            is on its way. Click it to activate your account.
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
          Create your account
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
          Get started with Taylslate in minutes.
        </p>
      </div>

      {error ? (
        <p className="mb-4 text-sm text-[var(--ts-ink-on-paper)]" role="alert">
          {error}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="fullName" className={labelClass}>
            Full name
          </label>
          <input
            id="fullName"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className={inputClass}
            style={{ borderRadius: tokens.radius }}
            placeholder="Jane Smith"
          />
        </div>

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

        <div>
          <label htmlFor="password" className={labelClass}>
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className={inputClass}
            style={{ borderRadius: tokens.radius }}
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
          className={primaryBtnClass}
          style={{ borderRadius: tokens.radius }}
        >
          {loading ? "Creating account..." : "Create account"}
        </button>
      </form>

      <p className="mt-8 text-sm text-[var(--ts-ink-muted-on-paper)]">
        Already have an account?{" "}
        <Link href="/login" className="text-[var(--ts-accent)] hover:underline">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
