// ============================================================
// GENRE PURCHASE-RATE BENCHMARKS (guidance)
//
// A cited purchase_rate for the show's genre can move purchase power
// by at most ±4 points, and only when at least two genres have a
// real number to compare. One cited row is quoted and does not move
// the score — there is no scale to rank it on. A null value is not
// a zero. Nothing here removes a show.
//
// purchase_rate is stored as a fraction (0.024 = 2.4%). A number
// greater than 1 is read as an already-percent figure (2.4 = 2.4%)
// so a cited percent isn't shown ten times too small.
//
// Pure. Never throws.
// ============================================================

export interface GenreBenchmark {
  genre: string;
  metric: string;
  value: number | null;
  source?: string | null;
  as_of?: string | null;
}

/** Largest purchase-power move a benchmark comparison can apply. */
export const BENCHMARK_PURCHASE_DELTA = 4;

export interface PurchaseRateGuidance {
  /** Null when this show's genre has no cited number. */
  line: string | null;
  /** 0 when there is nothing to compare, else within ±BENCHMARK_PURCHASE_DELTA. */
  delta: number;
}

export function purchaseRateGuidance(
  categories: string[] | null | undefined,
  benchmarks: GenreBenchmark[] | null | undefined
): PurchaseRateGuidance {
  const none: PurchaseRateGuidance = { line: null, delta: 0 };
  if (!benchmarks || benchmarks.length === 0) return none;

  const cited = benchmarks.filter(
    (row) => isPurchaseRate(row.metric) && typeof row.value === "number" && Number.isFinite(row.value)
  );

  const match = matchGenre(categories ?? [], benchmarks);
  if (!match || !isPurchaseRate(match.metric)) return none;
  if (typeof match.value !== "number" || !Number.isFinite(match.value)) return none;

  const line = formatLine(match);
  if (cited.length < 2) return { line, delta: 0 };

  const rates = cited.map((row) => asFraction(row.value as number));
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  if (!(max > min)) return { line, delta: 0 };

  const position = (asFraction(match.value) - min) / (max - min);
  const raw = Math.round(position * BENCHMARK_PURCHASE_DELTA * 2 - BENCHMARK_PURCHASE_DELTA);
  const delta = Math.max(-BENCHMARK_PURCHASE_DELTA, Math.min(BENCHMARK_PURCHASE_DELTA, raw));
  return { line, delta };
}

function matchGenre(
  categories: string[],
  benchmarks: GenreBenchmark[]
): GenreBenchmark | null {
  const wanted = new Set(categories.map(normalizeGenre).filter(Boolean));
  if (wanted.size === 0) return null;

  let fallback: GenreBenchmark | null = null;
  for (const row of benchmarks) {
    if (!wanted.has(normalizeGenre(row.genre))) continue;
    const cited =
      isPurchaseRate(row.metric) &&
      typeof row.value === "number" &&
      Number.isFinite(row.value);
    if (cited) return row;
    if (!fallback) fallback = row;
  }
  return fallback;
}

function formatLine(row: GenreBenchmark): string {
  const rate = formatRate(row.value as number);
  const source = row.source?.trim() || "source not recorded";
  const asOf = row.as_of?.trim() ? `, as of ${row.as_of.trim()}` : "";
  return `${row.genre.trim()} purchase-rate benchmark: ${rate} (${source}${asOf}). Guidance only.`;
}

function formatRate(value: number): string {
  const pct = asFraction(value) * 100;
  const rounded = Math.round(pct * 10) / 10;
  return `${rounded}%`;
}

/** Fraction in 0–1. Values above 1 are treated as already-percent. */
export function asFraction(value: number): number {
  if (value > 1) return value / 100;
  return value;
}

function isPurchaseRate(metric: string | null | undefined): boolean {
  if (!metric) return false;
  return normalizeGenre(metric) === "purchase rate";
}

function normalizeGenre(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
