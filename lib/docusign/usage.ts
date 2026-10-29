// Monthly DocuSign envelope count for internal admins.
//
// One io.sent_for_signature row is one envelope the brand send path created.
// The window is the America/Denver calendar month. A database error throws.
// Callers must not treat a failure as zero sends.

import { supabaseAdmin } from "@/lib/supabase/admin";

export const DOCUSIGN_MONTHLY_LIMIT = 40;
export const DOCUSIGN_WARN_AT = 35;

const DENVER = "America/Denver";

export type DocuSignUsageState = "ok" | "warn" | "over";
export type DocuSignEnvironment = "production" | "sandbox";

export type DenverMonthBounds = {
  startIso: string;
  nextStartIso: string;
  label: string;
};

export type DocuSignUsage = {
  used: number;
  limit: number;
  warnAt: number;
  remaining: number;
  state: DocuSignUsageState;
  month: string;
  environment: DocuSignEnvironment;
};

type DenverParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function denverParts(date: Date): DenverParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: DENVER,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

// UTC instant of 00:00 on the first of the given month in America/Denver.
// The US transition is at 02:00, so midnight on the 1st is not a fold.
// The loop re-samples the offset at the candidate instant anyway.
function denverMonthStartUtc(year: number, month: number): Date {
  let utc = Date.UTC(year, month - 1, 1, 0, 0, 0);
  for (let i = 0; i < 4; i++) {
    const seen = denverParts(new Date(utc));
    const seenAsUtc = Date.UTC(
      seen.year,
      seen.month - 1,
      seen.day,
      seen.hour,
      seen.minute,
      seen.second,
    );
    const offsetMs = seenAsUtc - utc;
    const desired = Date.UTC(year, month - 1, 1, 0, 0, 0);
    const next = desired - offsetMs;
    if (next === utc) break;
    utc = next;
  }
  return new Date(utc);
}

export function denverMonthBounds(now: Date): DenverMonthBounds {
  const { year, month } = denverParts(now);
  const start = denverMonthStartUtc(year, month);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const next = denverMonthStartUtc(nextYear, nextMonth);
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: DENVER,
    month: "long",
    year: "numeric",
  }).format(now);
  return {
    startIso: start.toISOString(),
    nextStartIso: next.toISOString(),
    label,
  };
}

function readEnvironment(): DocuSignEnvironment {
  return process.env.DOCUSIGN_ENV === "production" ? "production" : "sandbox";
}

function stateFor(used: number, environment: DocuSignEnvironment): DocuSignUsageState {
  if (environment === "sandbox") return "ok";
  if (used > DOCUSIGN_MONTHLY_LIMIT) return "over";
  if (used >= DOCUSIGN_WARN_AT) return "warn";
  return "ok";
}

export async function getDocuSignUsage(now = new Date()): Promise<DocuSignUsage> {
  const bounds = denverMonthBounds(now);
  const environment = readEnvironment();
  const { count, error } = await supabaseAdmin
    .from("domain_events")
    .select("*", { count: "exact", head: true })
    .eq("event_type", "io.sent_for_signature")
    .gte("created_at", bounds.startIso)
    .lt("created_at", bounds.nextStartIso);

  if (error || typeof count !== "number") {
    throw new Error(error?.message || "DocuSign usage count failed");
  }

  return {
    used: count,
    limit: DOCUSIGN_MONTHLY_LIMIT,
    warnAt: DOCUSIGN_WARN_AT,
    remaining: Math.max(0, DOCUSIGN_MONTHLY_LIMIT - count),
    state: stateFor(count, environment),
    month: bounds.label,
    environment,
  };
}
