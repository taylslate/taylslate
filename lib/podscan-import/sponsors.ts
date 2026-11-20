// Batch sponsor recency. A non-null episode id means Podscan found a
// sponsored episode in the last 365 days. The dry run checks 20 of
// those answers against latest/sponsor posted_at.

export const PROBE_CHUNK = 100;
export const PROBE_ACTIVE_DAYS = 365;
export const PROBE_EPISODES = 25;

export interface ProbeResponse {
  results?: Record<string, string | null>;
}

export function chunkIds(ids: readonly string[], size = PROBE_CHUNK): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

export async function probeSponsorRecency(
  ids: readonly string[],
  post: (ids: string[]) => Promise<ProbeResponse>
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const chunk of chunkIds(ids, PROBE_CHUNK)) {
    const res = await post(chunk);
    for (const id of chunk) {
      const value = res.results?.[id];
      out[id] = typeof value === "string" && value.length > 0 ? value : null;
    }
  }
  return out;
}

export interface ProbeCheck {
  podcastId: string;
  probeEpisodeId: string | null;
  postedAt: string | null;
  missing: boolean;
}

export function scoreProbeChecks(
  checks: readonly ProbeCheck[],
  now: Date
): { pass: boolean; mismatches: string[] } {
  const cutoff = now.getTime() - PROBE_ACTIVE_DAYS * 24 * 60 * 60 * 1000;
  const mismatches: string[] = [];
  for (const check of checks) {
    const posted = check.postedAt ? Date.parse(check.postedAt) : Number.NaN;
    const recent = Number.isFinite(posted) && posted >= cutoff;
    const probeRecent = check.probeEpisodeId != null;
    const latestRecent = !check.missing && recent;
    const latestOld = check.missing || (Number.isFinite(posted) && posted < cutoff);
    const agree = (probeRecent && latestRecent) || (!probeRecent && latestOld);
    if (!agree) mismatches.push(check.podcastId);
  }
  return { pass: checks.length - mismatches.length >= 18, mismatches };
}
