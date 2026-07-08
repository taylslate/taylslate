import { cookies } from "next/headers";
import Link from "next/link";
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
      <div className="min-h-screen flex items-center justify-center bg-[var(--brand-surface)] px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-bold text-[var(--brand-text)] mb-2">
            Reset link invalid
          </h1>
          <p className="text-sm text-[var(--brand-text-secondary)] mb-6">
            This reset link is invalid or has expired. Request a new one to
            continue.
          </p>
          <Link
            href="/forgot-password"
            className="text-sm text-[var(--brand-blue)] font-medium hover:underline"
          >
            Request a new reset link
          </Link>
        </div>
      </div>
    );
  }

  return <ResetPasswordForm />;
}
