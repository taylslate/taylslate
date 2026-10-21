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
      <span className="ts-wordmark text-[15px] font-semibold tracking-tight">taylslate</span>
    </Link>
  );
}

export function MarketingChrome({
  children,
  actions,
  wide = false,
  tone = "paper",
  className = "",
}: {
  children: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
  tone?: "paper" | "ink-gold";
  className?: string;
}) {
  const width = wide ? "max-w-6xl" : "max-w-5xl";
  const ink = tone === "ink-gold";
  return (
    <div
      className={`marketing-page flex min-h-screen flex-col text-[var(--ts-ink-on-paper)] ${
        ink ? "brand-app bg-[var(--ts-canvas)]" : "bg-[var(--ts-paper)]"
      } ${className}`}
    >
      <header
        className={`sticky top-0 z-10 border-b bg-[var(--ts-paper)] ${
          ink
            ? "border-[var(--ts-hairline-on-paper)]"
            : "border-[var(--ts-ink-on-paper)]/10"
        }`}
      >
        <nav className={`mx-auto flex ${width} items-center justify-between gap-4 px-6 py-3`}>
          <MarketingWordmark />
          {actions ? (
            <div className="flex items-center gap-4 sm:gap-6">{actions}</div>
          ) : null}
        </nav>
      </header>
      {children}
      <footer
        className={`border-t ${
          ink
            ? "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]"
            : "border-[var(--ts-ink-on-paper)]/10"
        }`}
      >
        <div className={`mx-auto flex ${width} items-center justify-between px-6 py-6`}>
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
