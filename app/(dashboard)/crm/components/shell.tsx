import type { ReactNode } from "react";
import { crmKicker, crmMuted } from "./chrome";

export function crmIndexLede(brandName: string): string {
  const sentence = "Contacts and notes are stored per show. Deal history stays read-only.";
  const name = brandName.trim();
  return name ? `${name}. ${sentence}` : sentence;
}

export function crmShowLede(brandName: string): string {
  const name = brandName.trim() || "this brand";
  return `Contacts and notes are for ${name} only. Deal history is read-only.`;
}

export function CrmShell({
  kicker,
  title,
  lede,
  children,
}: {
  kicker: string;
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  return (
    <div className="px-4 py-8 text-[var(--ts-ink-on-paper)] sm:px-8">
      <div className="mx-auto max-w-3xl">
        <p className={crmKicker}>{kicker}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
        {lede ? <p className={`mt-2 ${crmMuted}`}>{lede}</p> : null}
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}
