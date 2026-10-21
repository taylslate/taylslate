"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { ShowEmailCode } from "@/components/auth/show-email-code";

function ShowCodeLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in with a code</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
          For shows and creators. We email a 6-digit code.
        </p>
      </div>
      <ShowEmailCode
        nextPath={searchParams.get("next")}
        onVerified={(nextPath) => {
          router.push(nextPath);
          router.refresh();
        }}
      />
      <p className="mt-8 text-sm text-[var(--ts-ink-muted-on-paper)]">
        <Link href="/login" className="text-[var(--ts-accent)] hover:underline">
          Use a magic link instead
        </Link>
      </p>
    </>
  );
}

export default function ShowCodeLoginPage() {
  return (
    <AuthShell>
      <Suspense
        fallback={
          <p className="text-center text-sm text-[var(--ts-ink-muted-on-paper)]">
            Loading...
          </p>
        }
      >
        <ShowCodeLogin />
      </Suspense>
    </AuthShell>
  );
}
