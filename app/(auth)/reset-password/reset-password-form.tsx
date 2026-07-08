"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { validateNewPassword } from "./validate";
import { clearRecoveryCookie } from "./actions";

// Rendered only when the recovery marker cookie gated us in (see page.tsx).
// The Supabase recovery session (established server-side by /callback) is what
// authorizes updateUser; if it has since expired, updateUser surfaces the error.
export default function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = validateNewPassword(password, confirm);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }
    // Best-effort: retire the one-time recovery marker. A failure here must
    // not strand the user — the password is already changed.
    try {
      await clearRecoveryCookie();
    } catch {
      /* best-effort cleanup */
    }
    router.push("/dashboard");
    router.refresh();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--brand-surface)] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[var(--brand-text)]">
            Set a new password
          </h1>
          <p className="text-sm text-[var(--brand-text-secondary)] mt-2">
            Choose a new password for your account.
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
              htmlFor="new-password"
              className="block text-sm font-medium text-[var(--brand-text)] mb-1.5"
            >
              New password
            </label>
            <input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-[var(--brand-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/40 focus:border-[var(--brand-blue)]"
              placeholder="At least 8 characters"
            />
          </div>

          <div>
            <label
              htmlFor="confirm-password"
              className="block text-sm font-medium text-[var(--brand-text)] mb-1.5"
            >
              Confirm password
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-[var(--brand-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/40 focus:border-[var(--brand-blue)]"
              placeholder="Re-enter your new password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-[var(--brand-blue)] text-white rounded-xl font-semibold hover:bg-[var(--brand-blue-light)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Updating..." : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
