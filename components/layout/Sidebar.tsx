"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import SignOutButton from "@/components/auth/SignOutButton";
import {
  getNavItemsForRole,
  getPrimaryCtaForRole,
  type IconKey,
} from "@/lib/nav/items";
import type { UserRole } from "@/lib/data/types";
import { tokens } from "@/lib/brand/tokens";

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
  isAdmin,
  testAccounts,
}: {
  role: UserRole;
  canSwitchTo?: UserRole | null;
  isAdmin?: boolean;
  testAccounts?: { key: string; label: string }[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [switching, setSwitching] = useState(false);
  const [loggingInAs, setLoggingInAs] = useState<string | null>(null);

  const handleTestLogin = async (key: string) => {
    if (loggingInAs) return;
    setLoggingInAs(key);
    try {
      const res = await fetch("/api/admin/test-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (res.ok) {
        const { url } = await res.json();
        // Full navigation (not router.push) so the server callback runs and
        // swaps the session cookies before the dashboard re-renders.
        window.location.assign(url);
      } else {
        setLoggingInAs(null);
      }
    } catch {
      setLoggingInAs(null);
    }
  };

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

  const navRow =
    "flex items-center gap-3 px-3 py-2.5 text-sm font-medium mb-0.5";
  const quietRow =
    "text-[var(--ts-ink-muted-on-paper)] hover:bg-[var(--ts-band-shows)] hover:text-[var(--ts-ink-on-paper)]";

  return (
    <aside className="fixed left-0 top-0 flex h-screen w-[240px] flex-col border-r border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-[var(--ts-ink-on-paper)]">
      <div className="flex items-center gap-2.5 border-b border-[var(--ts-hairline-on-paper)] px-5 py-5">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <Image
            src="/mark.png"
            alt=""
            width={28}
            height={28}
            className="h-7 w-7"
            priority
          />
          <span className="text-[15px] font-semibold tracking-tight">
            taylslate
          </span>
        </Link>
      </div>

      <div className="px-3 pt-4 pb-2">
        <Link
          href={primary.href}
          className="flex w-full items-center justify-center gap-2 bg-[var(--ts-ink-on-paper)] py-2.5 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90"
          style={{ borderRadius: tokens.radius }}
        >
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
              className={`${navRow} ${
                isActive
                  ? "bg-[var(--ts-band-brands)] text-[var(--ts-ink-on-paper)]"
                  : quietRow
              }`}
              style={{ borderRadius: tokens.radius }}
            >
              <Icon name={item.iconKey} />
              {item.label}
            </Link>
          );
        })}
        <SignOutButton
          className={`w-full rounded text-left disabled:opacity-50 ${navRow} ${quietRow}`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sign out
        </SignOutButton>
      </nav>

      <div className="border-t border-[var(--ts-hairline-on-paper)] px-3 py-4">
        {isAdmin && testAccounts && testAccounts.length > 0 && (
          <div className="mb-3">
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--ts-ink-muted-on-paper)]">
              Internal
            </div>
            {testAccounts.map((acct) => (
              <button
                key={acct.key}
                type="button"
                onClick={() => handleTestLogin(acct.key)}
                disabled={loggingInAs !== null}
                className={`mb-1 w-full text-left text-xs font-medium disabled:opacity-50 ${navRow} ${quietRow}`}
                style={{ borderRadius: tokens.radius }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <polyline points="16 11 18 13 22 9" />
                </svg>
                {loggingInAs === acct.key ? "Logging in…" : `Log in as ${acct.label}`}
              </button>
            ))}
          </div>
        )}
        {canSwitchTo && (
          <button
            type="button"
            onClick={handleSwitch}
            disabled={switching}
            className={`mb-2 w-full text-left text-xs font-medium disabled:opacity-50 ${navRow} ${quietRow}`}
            style={{ borderRadius: tokens.radius }}
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
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ts-ink-on-paper)]/10">
            <span className="text-xs font-semibold text-[var(--ts-ink-on-paper)]">U</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">Free Plan</div>
            <Link href="/settings" className="text-xs text-[var(--ts-accent)] hover:underline">Upgrade</Link>
          </div>
        </div>
      </div>
    </aside>
  );
}
