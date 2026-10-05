"use client";

/**
 * Shared card-grid used by ad formats, ad read types, placements, and
 * category exclusions. Mirrors the category-selector style from brand
 * onboarding but with a generic value type.
 */
export interface MultiCardOption<T extends string> {
  value: T;
  title: string;
  sub?: string;
  emoji?: string;
}

export function MultiCardGrid<T extends string>({
  options,
  selected,
  onToggle,
  maxPick,
  columns = 2,
  mutuallyExclusive,
}: {
  options: MultiCardOption<T>[];
  selected: Set<T>;
  onToggle: (value: T) => void;
  maxPick?: number;
  columns?: 1 | 2 | 3;
  /** If this value is selected, all others become disabled (e.g. "none"). */
  mutuallyExclusive?: T;
}) {
  const count = selected.size;
  const cap = maxPick ?? options.length;
  const exclusiveSelected = mutuallyExclusive != null && selected.has(mutuallyExclusive);

  const gridCols = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" }[columns];

  return (
    <div className={`grid ${gridCols} gap-2.5`}>
      {options.map((opt) => {
        const isSelected = selected.has(opt.value);
        const isExclusiveRow = mutuallyExclusive === opt.value;
        const disabled =
          (!isSelected && count >= cap) ||
          (exclusiveSelected && !isExclusiveRow) ||
          (!exclusiveSelected && mutuallyExclusive != null && isExclusiveRow && count > 0 && !isSelected);

        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onToggle(opt.value)}
            disabled={disabled}
            className={`rounded-[var(--ts-radius)] border bg-[var(--ts-paper)] p-3.5 text-left transition-all ${
              isSelected
                ? "border-[var(--ts-ink-on-paper)] ring-2 ring-inset ring-[var(--ts-ink-on-paper)]"
                : disabled
                  ? "cursor-not-allowed border-[var(--ts-hairline-on-paper)] opacity-40"
                  : "border-[var(--ts-hairline-on-paper)] hover:border-[var(--ts-ink-on-paper)]"
            }`}
          >
            {opt.emoji && <div className="mb-1 text-xl">{opt.emoji}</div>}
            <div className="text-sm font-semibold leading-tight text-[var(--ts-ink-on-paper)]">
              {opt.title}
            </div>
            {opt.sub && (
              <div className="mt-1 text-xs leading-snug text-[var(--ts-ink-muted-on-paper)]">
                {opt.sub}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
