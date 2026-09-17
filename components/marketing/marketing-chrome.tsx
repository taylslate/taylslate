import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";

export function MarketingWordmark() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <Image
        src="/mark.png"
        alt=""
        width={28}
        height={28}
        className="h-7 w-7"
        priority
      />
      <span className="text-[15px] font-semibold tracking-tight">taylslate</span>
    </Link>
  );
}

export function MarketingChrome({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="marketing-page flex min-h-screen flex-col bg-[var(--ts-paper)] text-[var(--ts-ink-on-paper)]">
      <header className="border-b border-[var(--ts-ink-on-paper)]/10">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <MarketingWordmark />
          {actions ? (
            <div className="flex items-center gap-6">{actions}</div>
          ) : null}
        </nav>
      </header>
      {children}
      <footer className="border-t border-[var(--ts-ink-on-paper)]/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
          <span className="text-sm text-[var(--ts-ink-muted-on-paper)]">
            &copy; 2026 Taylslate
          </span>
          <div className="flex items-center gap-6">
            <Link
              href="#"
              className="text-sm text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
            >
              Terms
            </Link>
            <Link
              href="#"
              className="text-sm text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
            >
              Privacy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
