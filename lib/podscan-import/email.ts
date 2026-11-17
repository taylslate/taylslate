// Syntax and MX checks. No message is sent. mx_ok null means the
// lookup could not decide. Status is ok only when syntax passes and
// the MX lookup is a clear yes.

export type ContactSource = "podscan" | "apple_rss";
export type ContactRowStatus = "ok" | "needs_manual_lookup";

const REJECTED = ["example.com", "example.org", "test", "localhost", "invalid"];

export interface DnsLike {
  resolveMx(domain: string): Promise<Array<{ exchange: string; priority: number }>>;
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
}

export interface MxResult {
  mxOk: boolean | null;
  checkedAt: string;
}

export function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain || domain.includes("@") || /\s/.test(domain)) return null;
  return domain;
}

function rejectedDomain(domain: string): boolean {
  return REJECTED.some((item) => domain === item || domain.endsWith(`.${item}`));
}

export function checkSyntax(raw: string): { ok: boolean; email: string } {
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254 || /\s/.test(email)) return { ok: false, email };
  const parts = email.split("@");
  if (parts.length !== 2) return { ok: false, email };
  const [local, domain] = parts;
  if (!local || !domain || !domain.includes(".")) return { ok: false, email };
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return { ok: false, email };
  }
  if (rejectedDomain(domain)) return { ok: false, email };
  return { ok: true, email };
}

export function emailStatus(syntaxOk: boolean, mxOk: boolean | null): ContactRowStatus {
  return syntaxOk && mxOk === true ? "ok" : "needs_manual_lookup";
}

export function contactStatus(statuses: readonly ContactRowStatus[]): ContactRowStatus {
  return statuses.some((status) => status === "ok") ? "ok" : "needs_manual_lookup";
}

function errorCode(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

function isNegative(code: string): boolean {
  return code === "ENOTFOUND" || code === "ENODATA" || code === "ENOTIMP";
}

function isUnknown(code: string, err: unknown): boolean {
  if (code === "ETIMEOUT" || code === "ESERVFAIL" || code === "SERVFAIL") return true;
  if (err instanceof Error && (err.name === "TimeoutError" || err.message === "timeout")) return true;
  return false;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error("timeout");
      err.name = "TimeoutError";
      reject(err);
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

type Step = "ok" | "no" | "unknown";

async function oneStep(work: () => Promise<unknown[]>, timeoutMs: number): Promise<Step> {
  try {
    const value = await withTimeout(work(), timeoutMs);
    if (Array.isArray(value) && value.length > 0) return "ok";
    return "no";
  } catch (err) {
    const code = errorCode(err);
    if (isNegative(code)) return "no";
    if (isUnknown(code, err)) return "unknown";
    return "unknown";
  }
}

async function stepWithRetry(work: () => Promise<unknown[]>, timeoutMs: number): Promise<Step> {
  const first = await oneStep(work, timeoutMs);
  if (first !== "unknown") return first;
  return oneStep(work, timeoutMs);
}

export async function lookupMx(
  domain: string,
  dns: DnsLike,
  cache: Map<string, MxResult>,
  opts?: { timeoutMs?: number; now?: () => Date }
): Promise<MxResult> {
  const cached = cache.get(domain);
  if (cached) return cached;
  const timeoutMs = opts?.timeoutMs ?? 5_000;
  const now = opts?.now ?? (() => new Date());
  const mx = await stepWithRetry(() => dns.resolveMx(domain), timeoutMs);
  let outcome: Step = mx;
  if (mx === "no") {
    const v4 = await stepWithRetry(() => dns.resolve4(domain), timeoutMs);
    outcome = v4;
    if (v4 === "no") outcome = await stepWithRetry(() => dns.resolve6(domain), timeoutMs);
  }
  const result: MxResult = {
    mxOk: outcome === "ok" ? true : outcome === "no" ? false : null,
    checkedAt: now().toISOString(),
  };
  cache.set(domain, result);
  return result;
}

export interface CheckedEmail {
  source: ContactSource;
  email: string;
  syntaxOk: boolean;
  mxOk: boolean | null;
  status: ContactRowStatus;
}

export async function checkEmails(
  inputs: Array<{ source: ContactSource; raw: string }>,
  dns: DnsLike,
  cache: Map<string, MxResult>
): Promise<CheckedEmail[]> {
  const seen = new Set<string>();
  const out: CheckedEmail[] = [];
  for (const input of inputs) {
    const syntax = checkSyntax(input.raw);
    if (!syntax.email) continue;
    const key = `${input.source}\0${syntax.email}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!syntax.ok || syntax.email.length > 254) {
      if (syntax.email.length > 254) continue;
      out.push({
        source: input.source,
        email: syntax.email,
        syntaxOk: false,
        mxOk: null,
        status: "needs_manual_lookup",
      });
      continue;
    }
    const domain = domainOf(syntax.email);
    const mx = domain ? await lookupMx(domain, dns, cache) : { mxOk: false, checkedAt: "" };
    out.push({
      source: input.source,
      email: syntax.email,
      syntaxOk: true,
      mxOk: mx.mxOk,
      status: emailStatus(true, mx.mxOk),
    });
  }
  return out;
}
