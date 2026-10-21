"use client";

import { Suspense, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { tokens } from "@/lib/brand/tokens";
import { AuthShell, inputClass } from "@/components/auth/auth-shell";
import { ShowEmailCode } from "@/components/auth/show-email-code";
import {
  TurnstileWidget,
  type TurnstileHandle,
} from "@/components/auth/turnstile-widget";
import {
  withCaptchaToken,
  isCaptchaError,
  CAPTCHA_RETRY_MESSAGE,
} from "@/lib/auth/turnstile";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | undefined>();
  const turnstileRef = useRef<TurnstileHandle>(null);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

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
      setSubmitting(false);
      return;
    }

    const next = searchParams.get("next") || "/dashboard";
    router.push(next);
    router.refresh();
  };

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
          We&apos;ll email a 6-digit code.
        </p>
      </div>

      <ShowEmailCode
        emailValue={email}
        onEmailChange={setEmail}
        nextPath={searchParams.get("next")}
        onVerified={(nextPath) => {
          router.push(nextPath);
          router.refresh();
        }}
      />

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
            {error ? (
              <p className="text-sm text-[var(--ts-ink-on-paper)]" role="alert">
                {error}
              </p>
            ) : null}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-[var(--ts-accent-text)] hover:underline"
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
            <TurnstileWidget
              ref={turnstileRef}
              onVerify={setCaptchaToken}
              onExpire={() => setCaptchaToken(undefined)}
              onError={() => setCaptchaToken(undefined)}
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full border border-[var(--ts-ink-on-paper)]/20 py-2.5 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-ink-on-paper)]/5 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ borderRadius: tokens.radius }}
            >
              {submitting ? "Logging in..." : "Log in"}
            </button>
          </form>
        ) : null}
      </div>

      <p className="mt-8 text-sm text-[var(--ts-ink-muted-on-paper)]">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-[var(--ts-accent-text)] hover:underline">
          Sign up
        </Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense
        fallback={
          <p className="text-center text-sm text-[var(--ts-ink-muted-on-paper)]">
            Loading...
          </p>
        }
      >
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
