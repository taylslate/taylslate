import { cookies } from "next/headers";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { RECOVERY_COOKIE } from "@/lib/auth/recovery-cookie";
import ResetPasswordForm from "./reset-password-form";

// Server-component gate: the set-new-password form is shown ONLY when the
// short-lived recovery marker cookie is present — i.e. the user just arrived
// via a verified password-recovery link (set by /callback). Any other visit
// (a logged-in brand, a passwordless magic-link show, a cold/expired link)
// gets the invalid-link state instead of a form bound to their live session.
export default async function ResetPasswordPage() {
  const cookieStore = await cookies();
  const cameViaRecovery = cookieStore.get(RECOVERY_COOKIE)?.value === "1";

  if (!cameViaRecovery) {
    return (
      <AuthShell>
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Reset link invalid
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
            This reset link is invalid or has expired. Request a new one to
            continue.
          </p>
          <Link
            href="/forgot-password"
            className="mt-8 inline-block text-sm text-[var(--ts-accent)] hover:underline"
          >
            Request a new reset link
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <ResetPasswordForm />
    </AuthShell>
  );
}
