"use client";

import { useEffect, useState } from "react";

type Usage = {
  used: number;
  limit: number;
  warnAt: number;
  remaining: number;
  state: "ok" | "warn" | "over";
  month: string;
  environment: "production" | "sandbox";
};

type View =
  | { kind: "pending" }
  | { kind: "hidden" }
  | { kind: "unavailable" }
  | { kind: "ready"; usage: Usage };

const okClass = "text-sm text-[var(--ts-ink-muted-on-paper)]";
const warnClass =
  "border-l-2 border-[var(--ts-gold)] pl-3 text-sm font-medium text-[var(--ts-ink-on-paper)]";

function envelopes(n: number): string {
  return n === 1 ? "1 envelope" : `${n} envelopes`;
}

function lineCopy(usage: Usage): { text: string; tone: "ok" | "warn" } {
  if (usage.environment === "sandbox") {
    return {
      tone: "ok",
      text: `DocuSign is in sandbox. ${envelopes(usage.used)} this month. Sandbox envelopes do not count against the plan.`,
    };
  }
  if (usage.state === "over") {
    return {
      tone: "warn",
      text: `${usage.used} of ${usage.limit} DocuSign envelopes used this month. Over the plan allowance. Sends are not blocked. DocuSign sets the overage price.`,
    };
  }
  if (usage.state === "warn") {
    const left = usage.remaining <= 0 ? "None left." : `${usage.remaining} left.`;
    return {
      tone: "warn",
      text: `${usage.used} of ${usage.limit} DocuSign envelopes used this month. ${left} Sends are not blocked.`,
    };
  }
  return {
    tone: "ok",
    text: `${usage.used} of ${usage.limit} DocuSign envelopes used this month`,
  };
}

export default function DocuSignUsageLine() {
  const [view, setView] = useState<View>({ kind: "pending" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/docusign-usage", { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 500) {
          setView({ kind: "unavailable" });
          return;
        }
        if (!res.ok) {
          setView({ kind: "hidden" });
          return;
        }
        const body = (await res.json()) as Usage;
        if (typeof body?.used !== "number" || typeof body.limit !== "number") {
          setView({ kind: "unavailable" });
          return;
        }
        setView({ kind: "ready", usage: body });
      })
      .catch(() => {
        if (!cancelled) setView({ kind: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (view.kind === "pending" || view.kind === "hidden") return null;

  if (view.kind === "unavailable") {
    return (
      <p className={`mx-4 mt-4 sm:mx-8 sm:mt-8 ${okClass}`}>DocuSign usage unavailable</p>
    );
  }

  const copy = lineCopy(view.usage);
  return (
    <p className={`mx-4 mt-4 sm:mx-8 sm:mt-8 ${copy.tone === "warn" ? warnClass : okClass}`}>
      {copy.text}
    </p>
  );
}
