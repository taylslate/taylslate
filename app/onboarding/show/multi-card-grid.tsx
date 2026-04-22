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
            className={`p-3.5 rounded-xl border text-left transition-all ${
              isSelected
                ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.04] ring-2 ring-[var(--brand-blue)]/20"
                : disabled
                  ? "border-[var(--brand-border)] bg-[var(--brand-surface)] opacity-40 cursor-not-allowed"
                  : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] hover:border-[var(--brand-blue)]/30"
            }`}
          >
            {opt.emoji && <div className="text-xl mb-1">{opt.emoji}</div>}
            <div className="text-sm font-semibold text-[var(--brand-text)] leading-tight">
              {opt.title}
            </div>
            {opt.sub && (
              <div className="text-xs text-[var(--brand-text-muted)] mt-1 leading-snug">
                {opt.sub}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
