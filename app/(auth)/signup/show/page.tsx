"use client";

// Show / creator self-sign-up (R1). An email code, no password. The account
// is created server-side with role "show" when the code is verified; nothing
// here can pick a role. A signed-in visitor is sent to /dashboard.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "@/components/auth/auth-shell";
import { ShowEmailCode } from "@/components/auth/show-email-code";

export default function ShowSignupPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        router.replace("/dashboard");
      } else {
        setAuthChecked(true);
      }
    });
  }, [router]);

  if (!authChecked) {
    return null;
  }

  return (
    <AuthShell>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Sign up as a show or creator
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
          We&apos;ll email you a 6-digit code. No password.
        </p>
      </div>

      <ShowEmailCode
        intent="show_signup"
        nextPath="/onboarding/show"
        sentNotice={
          <p className="text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
            We emailed you a 6-digit code. Enter it below.
          </p>
        }
        onVerified={(nextPath) => {
          router.push(nextPath);
          router.refresh();
        }}
      />
    </AuthShell>
  );
}
