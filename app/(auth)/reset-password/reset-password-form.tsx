"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { tokens } from "@/lib/brand/tokens";
import {
  inputClass,
  labelClass,
  primaryBtnClass,
} from "@/components/auth/auth-shell";
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
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Set a new password
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
          Choose a new password for your account.
        </p>
      </div>

      {error ? (
        <p className="mb-4 text-sm text-[var(--ts-ink-on-paper)]" role="alert">
          {error}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="new-password" className={labelClass}>
            New password
          </label>
          <input
            id="new-password"
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

        <div>
          <label htmlFor="confirm-password" className={labelClass}>
            Confirm password
          </label>
          <input
            id="confirm-password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={8}
            className={inputClass}
            style={{ borderRadius: tokens.radius }}
            placeholder="Re-enter your new password"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className={primaryBtnClass}
          style={{ borderRadius: tokens.radius }}
        >
          {loading ? "Updating..." : "Update password"}
        </button>
      </form>
    </>
  );
}
