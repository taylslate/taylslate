"use client";

// Return-to-admin action on the impersonation banner (Layer 3). POSTs to the
// redeem endpoint, then does a full navigation to the returned /callback URL so
// the server verifies the token_hash and swaps the session cookies back to the
// admin before the dashboard re-renders (router.push wouldn't run the callback).

import { useState } from "react";

export default function ReturnToAdminButton() {
  const [returning, setReturning] = useState(false);

  const handleReturn = async () => {
    if (returning) return;
    setReturning(true);
    try {
      const res = await fetch("/api/admin/return-to-admin", { method: "POST" });
      if (res.ok) {
        const { url } = await res.json();
        window.location.assign(url);
      } else {
        setReturning(false);
      }
    } catch {
      setReturning(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleReturn}
      disabled={returning}
      className="ml-3 inline-flex items-center gap-1.5 rounded-md bg-white/20 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/30 disabled:opacity-60 transition-colors"
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h11a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5H9" />
      </svg>
      {returning ? "Returning…" : "Return to admin"}
    </button>
  );
}
