"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import type { ShowProfile } from "@/lib/data/types";
import {
  SHOW_ONBOARDING_STEPS,
  TOTAL_STEPS,
  nextStepSlug,
  prevStepSlug,
  stepIndexOf,
  type ShowOnboardingSlug,
} from "./steps";

interface ShellProps {
  slug: ShowOnboardingSlug;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /**
   * If provided, the "Continue" button posts this patch to /api/show-profile
   * before advancing. Return `false` to block navigation.
   */
  onContinue?: () => Promise<Partial<ShowProfile> | false>;
  continueLabel?: string;
  continueDisabled?: boolean;
  hideBack?: boolean;
}

async function persist(patch: Partial<ShowProfile>): Promise<ShowProfile | null> {
  const res = await fetch("/api/show-profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.show_profile as ShowProfile;
}

export default function OnboardingShell({
  slug,
  title,
  subtitle,
  children,
  onContinue,
  continueLabel,
  continueDisabled,
  hideBack,
}: ShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("return");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = stepIndexOf(slug);
  const progressPct = Math.round(((current + 1) / TOTAL_STEPS) * 100);

  const handleContinue = useCallback(async () => {
    if (continueDisabled || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      let patch: Partial<ShowProfile> | false | undefined;
      if (onContinue) {
        patch = await onContinue();
        if (patch === false) {
          setSubmitting(false);
          return;
        }
      }
      if (patch) {
        const saved = await persist(patch);
        if (!saved) {
          setError("Couldn't save your answer — try again.");
          setSubmitting(false);
          return;
        }
      }
      if (returnTo === "summary") {
        router.push("/onboarding/show/summary");
        return;
      }
      const next = nextStepSlug(slug);
      if (next) {
        router.push(`/onboarding/show/${next}`);
      } else {
        router.push("/dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }, [onContinue, router, slug, submitting, continueDisabled, returnTo]);

  const back = prevStepSlug(slug);

  return (
    <div className="flex min-h-screen flex-col bg-[var(--ts-paper)] text-[var(--ts-ink-on-paper)]">
      <div className="h-1 w-full bg-[var(--ts-hairline-on-paper)]">
        <div
          className="h-full bg-[var(--ts-ink-on-paper)] transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="flex items-center border-b border-[var(--ts-hairline-on-paper)] px-8 py-5">
        <div className="text-xs text-[var(--ts-ink-muted-on-paper)]">
          Step {current + 1} of {TOTAL_STEPS} · {SHOW_ONBOARDING_STEPS[current].label}
        </div>
      </div>

      <div className="flex flex-1 items-start justify-center p-8 pt-16">
        <div className="w-full max-w-xl">
          <h1 className="text-3xl font-bold tracking-tight text-[var(--ts-ink-on-paper)]">{title}</h1>
          {subtitle && <p className="mt-2 mb-8 text-[var(--ts-ink-muted-on-paper)]">{subtitle}</p>}
          {!subtitle && <div className="mb-8" />}

          <div className="mb-8">{children}</div>

          {error && (
            <div className="mb-4 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] p-3 text-sm text-[var(--ts-accent)]">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between">
            {!hideBack && back ? (
              <Link
                href={`/onboarding/show/${back}`}
                className="text-sm text-[var(--ts-ink-muted-on-paper)] transition-colors hover:text-[var(--ts-ink-on-paper)]"
              >
                ← Back
              </Link>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={handleContinue}
              disabled={continueDisabled || submitting}
              className="inline-flex items-center gap-2 rounded-[var(--ts-radius)] bg-[var(--ts-ink-on-paper)] px-6 py-3 text-sm font-semibold text-[var(--ts-paper)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving…
                </>
              ) : (
                continueLabel ?? "Continue"
              )}
              {!submitting && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
