"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Sign-out control. Calls Supabase auth.signOut() and redirects to /login.
 * Accepts children so it can render as a sidebar row or a button in
 * Settings — styling is the caller's responsibility.
 */
export default function SignOutButton({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } finally {
      // Force a fresh auth state check by doing a server-handled redirect
      router.replace("/login");
      router.refresh();
    }
  };

  return (
    <button type="button" onClick={handleSignOut} disabled={signingOut} className={className}>
      {signingOut ? "Signing out…" : children}
    </button>
  );
}
