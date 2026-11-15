"use client";

import { useState } from "react";
import Image from "next/image";
import { appBodyFont, appDisplayFont } from "@/lib/brand/app-fonts";
import {
  EXPIRED_COPY,
  PLAN_COPY,
  SCOPE_LINES,
  UNAVAILABLE_COPY,
  type ConsentScope,
} from "@/lib/mcp-oauth/copy";

const KNOWN = new Set([EXPIRED_COPY, PLAN_COPY, UNAVAILABLE_COPY]);

const shellClass = `brand-app flex min-h-screen items-center justify-center bg-[var(--ts-canvas)] p-6 text-[var(--ts-ink-on-paper)] ${appDisplayFont.variable} ${appBodyFont.variable}`;

const cardClass =
  "w-full max-w-md rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-8 shadow-sm";

const navyButtonClass =
  "rounded-[var(--ts-radius)] bg-[var(--ts-accent)] px-4 py-2 font-semibold text-[var(--ts-accent-foreground)] disabled:opacity-50";

const denyButtonClass =
  "rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2 font-semibold text-[var(--ts-ink-on-paper)] disabled:opacity-50";

export interface ConsentCardProps {
  mode: "ready" | "expired" | "no_api" | "unavailable";
  requestId?: string;
  clientName?: string;
  redirectHost?: string;
  scopes?: ConsentScope[];
}

function BrandMark() {
  return (
    <div className="mb-6 flex items-center gap-2.5" aria-hidden="true">
      <Image src="/mark.png" alt="" width={28} height={28} className="h-7 w-7" />
      <span className="ts-wordmark text-[15px]">taylslate</span>
    </div>
  );
}

export function ConsentCard({
  mode,
  requestId,
  clientName = "",
  redirectHost = "",
  scopes = [],
}: ConsentCardProps) {
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function choose(decision: "allow" | "deny") {
    if (!requestId || pending) return;
    setPending(decision);
    setNotice(null);
    try {
      const response = await fetch("/api/oauth/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId, decision }),
      });
      const body = (await response.json()) as { redirect?: unknown; error_description?: unknown };
      if (typeof body.redirect === "string" && body.redirect.length > 0) {
        window.location.assign(body.redirect);
        return;
      }
      const description = typeof body.error_description === "string" ? body.error_description : "";
      setNotice(KNOWN.has(description) ? description : UNAVAILABLE_COPY);
      setPending(null);
    } catch {
      setNotice(UNAVAILABLE_COPY);
      setPending(null);
    }
  }

  return (
    <main className={shellClass}>
      <section className={cardClass}>
        <BrandMark />
        {mode === "expired" ? (
          <>
            <h1 className="text-2xl">Connect an app to Taylslate</h1>
            <p className="mt-4 text-[var(--ts-ink-muted-on-paper)]">{EXPIRED_COPY}</p>
          </>
        ) : null}
        {mode === "unavailable" ? (
          <>
            <h1 className="text-2xl">Connect an app to Taylslate</h1>
            <p className="mt-4 text-[var(--ts-ink-muted-on-paper)]">{UNAVAILABLE_COPY}</p>
          </>
        ) : null}
        {mode === "no_api" ? (
          <>
            <h1 className="text-2xl">Connect an app to Taylslate</h1>
            <p className="mt-4">{PLAN_COPY}</p>
            <a href="/settings/billing" className={`mt-6 inline-block ${navyButtonClass}`}>
              Billing
            </a>
          </>
        ) : null}
        {mode === "ready" ? (
          <>
            <h1 className="text-2xl">Connect {clientName} to Taylslate</h1>
            <p className="mt-4">
              {clientName} is asking to use your Taylslate account through MCP. Taylslate did not review this app.
            </p>
            <p className="mt-3">It will return you to {redirectHost}.</p>
            <ul className="mt-4 space-y-2">
              {scopes.map((scope) => (
                <li key={scope} className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ts-gold)]"
                  />
                  <span>{SCOPE_LINES[scope]}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[var(--ts-ink-muted-on-paper)]">
              Nothing is sent, signed, charged or paid without your approval. You can disconnect this app anytime in
              Settings, API keys.
            </p>
            {notice ? <p className="mt-4">{notice}</p> : null}
            <div className="mt-6 flex flex-row gap-3">
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void choose("allow")}
                className={navyButtonClass}
              >
                Allow
              </button>
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void choose("deny")}
                className={denyButtonClass}
              >
                Deny
              </button>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
