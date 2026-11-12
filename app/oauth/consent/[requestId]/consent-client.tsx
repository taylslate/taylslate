"use client";

import { useState } from "react";
import {
  EXPIRED_COPY,
  PLAN_COPY,
  SCOPE_LINES,
  UNAVAILABLE_COPY,
  type ConsentScope,
} from "@/lib/mcp-oauth/copy";

const KNOWN = new Set([EXPIRED_COPY, PLAN_COPY, UNAVAILABLE_COPY]);

export interface ConsentCardProps {
  mode: "ready" | "expired" | "no_api" | "unavailable";
  requestId?: string;
  clientName?: string;
  redirectHost?: string;
  scopes?: ConsentScope[];
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
    <main className="flex min-h-screen items-center justify-center bg-[var(--ts-paper)] p-6 text-[var(--ts-ink-on-paper)]">
      <section className="w-full max-w-lg rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-8">
        {mode === "expired" ? (
          <>
            <h1 className="text-2xl font-semibold">Connect an app to Taylslate</h1>
            <p className="mt-4 text-[var(--ts-ink-muted-on-paper)]">{EXPIRED_COPY}</p>
          </>
        ) : null}
        {mode === "unavailable" ? (
          <>
            <h1 className="text-2xl font-semibold">Connect an app to Taylslate</h1>
            <p className="mt-4 text-[var(--ts-ink-muted-on-paper)]">{UNAVAILABLE_COPY}</p>
          </>
        ) : null}
        {mode === "no_api" ? (
          <>
            <h1 className="text-2xl font-semibold">Connect an app to Taylslate</h1>
            <p className="mt-4">{PLAN_COPY}</p>
            <a
              href="/settings/billing"
              className="mt-6 inline-block rounded-[var(--ts-radius)] bg-[var(--ts-ink-on-paper)] px-4 py-2 font-semibold text-[var(--ts-paper)]"
            >
              Billing
            </a>
          </>
        ) : null}
        {mode === "ready" ? (
          <>
            <h1 className="text-2xl font-semibold">Connect {clientName} to Taylslate</h1>
            <p className="mt-4">
              {clientName} is asking to use your Taylslate account through MCP. Taylslate did not review this app.
            </p>
            <p className="mt-3">It will return you to {redirectHost}.</p>
            <ul className="mt-4 list-disc pl-5">
              {scopes.map((scope) => (
                <li key={scope}>{SCOPE_LINES[scope]}</li>
              ))}
            </ul>
            <p className="mt-4 text-[var(--ts-ink-muted-on-paper)]">
              Nothing is sent, signed, charged or paid without your approval. You can disconnect this app anytime in
              Settings, API keys.
            </p>
            {notice ? <p className="mt-4">{notice}</p> : null}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void choose("allow")}
                className="rounded-[var(--ts-radius)] bg-[var(--ts-ink-on-paper)] px-4 py-2 font-semibold text-[var(--ts-paper)] disabled:opacity-50"
              >
                Allow
              </button>
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void choose("deny")}
                className="rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] px-4 py-2 font-semibold text-[var(--ts-ink-on-paper)] disabled:opacity-50"
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
