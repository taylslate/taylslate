"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import SignOutButton from "@/components/auth/SignOutButton";
import {
  getNavItemsForRole,
  getPrimaryCtaForRole,
  type IconKey,
} from "@/lib/nav/items";
import type { UserRole } from "@/lib/data/types";

function Icon({ name }: { name: IconKey }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "dashboard":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="4" rx="1" />
          <rect x="14" y="11" width="7" height="10" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case "campaigns":
      return (
        <svg {...common}>
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" x2="4" y1="22" y2="15" />
        </svg>
      );
    case "deals":
      return (
        <svg {...common}>
          <path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0C1.46 6.7 1.33 10.28 4 13l8 8 8-8c2.67-2.72 2.54-6.3.42-8.42z" />
          <path d="M12 5.36 8.87 8.5a2.13 2.13 0 0 0 0 3h0a2.13 2.13 0 0 0 3 0l2.26-2.21a3 3 0 0 1 4.22 0l2.78 2.71" />
        </svg>
      );
    case "invoices":
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" x2="8" y1="13" y2="13" />
          <line x1="16" x2="8" y1="17" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      );
    case "shows":
      return (
        <svg {...common}>
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common} strokeWidth={2} width={14} height={14}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "upload":
      return (
        <svg {...common} width={14} height={14}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" x2="12" y1="3" y2="15" />
        </svg>
      );
  }
}

export default function Sidebar({
  role,
  canSwitchTo,
}: {
  role: UserRole;
  canSwitchTo?: UserRole | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  const navItems = getNavItemsForRole(role);
  const primary = getPrimaryCtaForRole(role);

  const handleSwitch = async () => {
    if (!canSwitchTo || switching) return;
    setSwitching(true);
    try {
      const res = await fetch("/api/view-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: canSwitchTo }),
      });
      if (res.ok) {
        router.replace("/dashboard");
        router.refresh();
      } else {
        setSwitching(false);
      }
    } catch {
      setSwitching(false);
    }
  };

  return (
    <aside className="w-[240px] h-screen bg-[var(--brand-surface-elevated)] border-r border-[var(--brand-border)] flex flex-col fixed left-0 top-0">
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-[var(--brand-border)]">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[var(--brand-blue)] to-[var(--brand-teal)] flex items-center justify-center">
          <span className="text-white font-bold text-xs">T</span>
        </div>
        <span className="text-base font-bold tracking-tight text-[var(--brand-text)]">taylslate</span>
      </div>

      <div className="px-3 pt-4 pb-2">
        <Link href={primary.href} className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors">
          <Icon name={primary.iconKey} />
          {primary.label}
        </Link>
      </div>

      <nav className="flex-1 px-3 py-2">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mb-0.5 ${
                isActive
                  ? "bg-[var(--brand-blue)]/[0.08] text-[var(--brand-blue)]"
                  : "text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] hover:text-[var(--brand-text)]"
              }`}
            >
              <Icon name={item.iconKey} />
              {item.label}
            </Link>
          );
        })}
        <SignOutButton className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mb-0.5 text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] hover:text-[var(--brand-text)] disabled:opacity-50 text-left">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sign out
        </SignOutButton>
      </nav>

      <div className="px-3 py-4 border-t border-[var(--brand-border)]">
        {canSwitchTo && (
          <button
            type="button"
            onClick={handleSwitch}
            disabled={switching}
            className="w-full text-left flex items-center gap-3 px-3 py-2 mb-2 rounded-lg text-xs font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] hover:text-[var(--brand-text)] disabled:opacity-50 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 1l4 4-4 4" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <path d="M7 23l-4-4 4-4" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
            {switching ? "Switching…" : `View as ${canSwitchTo}`}
          </button>
        )}
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-[var(--brand-blue)]/10 flex items-center justify-center">
            <span className="text-xs font-semibold text-[var(--brand-blue)]">U</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-[var(--brand-text)] truncate">Free Plan</div>
            <Link href="/settings" className="text-xs text-[var(--brand-blue)] hover:underline">Upgrade</Link>
          </div>
        </div>
      </div>
    </aside>
  );
}
