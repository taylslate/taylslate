// Local resume file. Candidate, probe, and contact data older than
// 7 days is refetched. Writes go to a temp file, then rename.

import { chmod, mkdir, open, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import type { SearchState } from "./candidates";
import type { CheckedEmail } from "./email";
import type { ProbeCheck } from "./sponsors";

export const STALE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ContactProgress {
  appleFeedUrl: string | null;
  feedSource: "apple" | "podscan" | "none";
  feedUrl: string | null;
  feedSkip: string | null;
  rssEmail: string | null;
  checks: CheckedEmail[];
}

export interface EnrichProgress {
  demographics: unknown;
  listener: unknown;
}

export interface ProbeCheckProgress {
  pass: boolean;
  mismatches: string[];
  checked: number;
  checks?: ProbeCheck[];
}

export interface Checkpoint {
  version: 1;
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
