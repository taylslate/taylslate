// Scrubbed failure line. Step, error name, and a short reason.
// Emails, keys, query strings, and response bodies stay out of the line.

export const IMPORT_STEPS = [
  "search",
  "categories",
  "probe",
  "probeCheck",
  "contacts",
  "enrich",
  "backfill",
  "write",
  "checkpoint",
] as const;

export type ImportStep = (typeof IMPORT_STEPS)[number];

const STEP = Symbol("podscanImportStep");

function isStep(value: unknown): value is ImportStep {
  return typeof value === "string" && (IMPORT_STEPS as readonly string[]).includes(value);
}

export function importStepOf(err: unknown): ImportStep | null {
  if (!err || typeof err !== "object") return null;
  const value = (err as { [STEP]?: unknown })[STEP];
  return isStep(value) ? value : null;
}

export function tagStep(step: ImportStep, err: unknown): unknown {
  if (err && typeof err === "object") {
    try {
      Object.defineProperty(err, STEP, { value: step, enumerable: false });
    } catch {
      return err;
    }
    return err;
  }
  const wrapped = new Error(typeof err === "string" ? err : "unknown");
  Object.defineProperty(wrapped, STEP, { value: step, enumerable: false });
  return wrapped;
}

export async function inStep<T>(step: ImportStep, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (importStepOf(err)) throw err;
    throw tagStep(step, err);
  }
}

function errorName(err: unknown): string {
  const name = err instanceof Error ? err.name : "Error";
  if (/^[A-Za-z_$][A-Za-z0-9_$]{0,40}$/.test(name)) return name;
  return "Error";
}

function errorStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const status = (err as { status?: unknown }).status;
  if (typeof status !== "number" || !Number.isInteger(status)) return null;
  if (status < 0 || status > 999) return null;
  return status;
}

export function scrubReason(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  let text = raw.replace(/\s+/g, " ").trim();
  if (/[\[{]/.test(text)) text = "unexpected response";
  text = text.replace(/https?:\/\/\S+/gi, "redacted");
  text = text.replace(/\?[^\s]*/g, "");
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "redacted");
  text = text.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "redacted");
  text = text.replace(/\bBearer\s+\S+/gi, "Bearer redacted");
  text = text.replace(/\b[A-Za-z0-9_-]{20,}\b/g, "redacted");
  text = text.replace(/\s+/g, " ").trim();
  if (!text || text.includes("@") || text.includes("?") || /https?:/i.test(text)) text = "unavailable";
  if (text.length > 100) text = text.slice(0, 100).trim();
  return text || "unknown";
}

export function formatFailure(step: ImportStep, err: unknown): string {
  const named = importStepOf(err) ?? step;
  const status = errorStatus(err);
  const statusPart = status == null ? "" : ` status=${status}`;
  return `podscan-import failed step=${named} name=${errorName(err)}${statusPart} reason=${scrubReason(err)}`;
}
