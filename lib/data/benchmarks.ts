// ============================================================
// GENRE BENCHMARKS (migration 045)
//
// Read path for conviction scoring. Fail-soft: a missing table (the
// migration has not been applied yet) or any other error returns []
// so discovery scores exactly as it did without benchmarks.
// Never throws. Never writes.
// ============================================================

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { GenreBenchmark } from "@/lib/scoring/benchmarks";

interface BenchmarkQueryRow {
  genre: string;
  metric: string;
  value: number | string | null;
  source: string | null;
  as_of: string | null;
}

export async function listBenchmarks(): Promise<GenreBenchmark[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("benchmarks")
      .select("genre, metric, value, source, as_of");
    if (error) {
      console.warn("[benchmarks.listBenchmarks] read failed:", error.message);
      return [];
    }
    return ((data ?? []) as BenchmarkQueryRow[]).map((row) => ({
      genre: row.genre,
      metric: row.metric,
      value: readValue(row.value),
      source: row.source,
      as_of: row.as_of,
    }));
  } catch (err) {
    console.warn(
      "[benchmarks.listBenchmarks] threw:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/** numeric columns come back as strings from PostgREST. */
function readValue(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
