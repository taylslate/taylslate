// Local resume file. Age does not drop it. --fresh drops it.
// Writes go to a temp file, then rename.

import { chmod, mkdir, open, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import type { SearchState } from "./candidates";
import type { CheckedEmail, SyntaxFailReason } from "./email";
import type { ProbeCheck } from "./sponsors";

export const STALE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ContactProgress {
  appleFeedUrl: string | null;
  feedSource: "apple" | "podscan" | "none";
  feedUrl: string | null;
  feedSkip: string | null;
  rssEmail: string | null;
  checks: CheckedEmail[];
  syntaxFailureReasons?: Partial<Record<SyntaxFailReason, number>>;
}

export interface EnrichProgress {
  demographics: unknown;
  listener: unknown;
  // Absent on rows enriched before analysis was stored. Null means the
  // analysis call returned empty data.
  sponsorHistory?: unknown;
}

export interface ScoringProgress {
  reachScore: number | null;
  brandSafety: unknown | null;
}

export interface ProbeCheckProgress {
  pass: boolean;
  mismatches: string[];
  checked: number;
  checks?: ProbeCheck[];
}

export interface Checkpoint {
  version: 1;
  // null is a full run. Missing means the file does not say.
  sample?: number | null;
  searchSavedAt?: string;
  search?: SearchState;
  probeSavedAt?: string;
  probe?: Record<string, string | null>;
  probeCheckSavedAt?: string;
  probeCheck?: ProbeCheckProgress;
  contactsSavedAt?: string;
  contacts?: Record<string, ContactProgress>;
  mx?: Record<string, { mxOk: boolean | null; checkedAt: string }>;
  enrichSavedAt?: string;
  enrich?: Record<string, EnrichProgress>;
  scoringSavedAt?: string;
  scoring?: Record<string, ScoringProgress>;
}

export function hasImportProgress(checkpoint: Checkpoint): boolean {
  return (
    checkpoint.search != null ||
    checkpoint.searchSavedAt != null ||
    checkpoint.probe != null ||
    checkpoint.probeSavedAt != null ||
    checkpoint.probeCheck != null ||
    checkpoint.probeCheckSavedAt != null ||
    checkpoint.contacts != null ||
    checkpoint.contactsSavedAt != null ||
    checkpoint.mx != null ||
    checkpoint.enrich != null ||
    checkpoint.enrichSavedAt != null ||
    checkpoint.scoring != null ||
    checkpoint.scoringSavedAt != null
  );
}

export function clearImportProgress(checkpoint: Checkpoint): void {
  checkpoint.search = undefined;
  checkpoint.searchSavedAt = undefined;
  checkpoint.probe = undefined;
  checkpoint.probeSavedAt = undefined;
  checkpoint.probeCheck = undefined;
  checkpoint.probeCheckSavedAt = undefined;
  checkpoint.contacts = undefined;
  checkpoint.contactsSavedAt = undefined;
  checkpoint.mx = undefined;
  checkpoint.enrich = undefined;
  checkpoint.enrichSavedAt = undefined;
  checkpoint.scoring = undefined;
  checkpoint.scoringSavedAt = undefined;
}

// True when saved progress was dropped because the sample does not match.
export function alignCheckpointSample(checkpoint: Checkpoint, sample: number | null): boolean {
  if (checkpoint.sample !== undefined && checkpoint.sample === sample) return false;
  const drop = hasImportProgress(checkpoint);
  if (drop) clearImportProgress(checkpoint);
  checkpoint.sample = sample;
  return drop;
}

export function emptyCheckpoint(): Checkpoint {
  return { version: 1 };
}

export function isStale(savedAt: string | undefined, now: number, maxAgeMs = STALE_MS): boolean {
  if (!savedAt) return true;
  const parsed = Date.parse(savedAt);
  if (!Number.isFinite(parsed)) return true;
  return now - parsed > maxAgeMs;
}

export async function writeTextAtomic(
  filePath: string,
  text: string,
  hooks?: { beforeRename?: () => void }
): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.tmp-${randomBytes(4).toString("hex")}`;
  const handle = await open(tmp, "w", 0o600);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(tmp, 0o600);
  hooks?.beforeRename?.();
  await rename(tmp, filePath);
  await chmod(filePath, 0o600);
}

export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
  hooks?: { beforeRename?: () => void }
): Promise<void> {
  await writeTextAtomic(filePath, JSON.stringify(value), hooks);
}

export async function readScoringFile(dir: string): Promise<Record<string, ScoringProgress>> {
  try {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(join(dir, "scoring-backfill.json"), "utf8");
    const parsed = JSON.parse(text) as { version?: unknown; scoring?: unknown };
    if (!parsed || parsed.version !== 1) return {};
    return scoringMapFrom(parsed.scoring);
  } catch {
    return {};
  }
}

export async function writeScoringFile(dir: string, scoring: Record<string, ScoringProgress>): Promise<void> {
  await writeJsonAtomic(join(dir, "scoring-backfill.json"), { version: 1, scoring });
}

function scoringMapFrom(value: unknown): Record<string, ScoringProgress> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, ScoringProgress> = {};
  let skipped = 0;
  for (const [id, entry] of Object.entries(value)) {
    if (!isScoringEntry(entry)) {
      skipped += 1;
      continue;
    }
    out[id] = { reachScore: entry.reachScore, brandSafety: entry.brandSafety };
  }
  if (skipped > 0) console.warn(`Skipped ${skipped} scoring checkpoint entries.`);
  return out;
}

function isScoringEntry(value: unknown): value is ScoringProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!("reachScore" in value) || !("brandSafety" in value)) return false;
  const score = value.reachScore;
  if (score !== null && (typeof score !== "number" || !Number.isFinite(score))) return false;
  const safety = value.brandSafety;
  if (safety !== null && (typeof safety !== "object" || Array.isArray(safety))) return false;
  return true;
}

export async function readCheckpoint(filePath: string): Promise<Checkpoint> {
  try {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(filePath, "utf8");
    const parsed = JSON.parse(text) as Checkpoint;
    if (!parsed || parsed.version !== 1) return emptyCheckpoint();
    return parsed;
  } catch {
    return emptyCheckpoint();
  }
}
