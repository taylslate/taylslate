"use client";

// Section 1 of the brief intake: product URL → AI derivation → editable
// read-back card. Falls back to a paste-a-paragraph textarea when the URL
// can't be fetched (paywall, 404, timeout) or derivation fails.

import type { AovBucket, ProductDerivation } from "@/lib/data/types";

export interface ProductState {
  url: string;
  paragraph: string;
  fallbackMode: boolean;
  derivation: ProductDerivation | null;
  source: "url" | "paragraph";
  deriving: boolean;
  deriveError: string | null;
}

interface Props {
  state: ProductState;
  onChange: (updater: (prev: ProductState) => ProductState) => void;
  onDerive: (input: { url?: string; paragraph?: string }) => void;
}

const AOV_LABELS: Record<AovBucket, string> = {
  low: "Low (under $50)",
  mid: "Mid ($50-$500)",
  high: "High (over $500)",
};

const FIELD_CLASS =
  "w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all";

export default function ProductSection({ state, onChange, onDerive }: Props) {
  const { url, paragraph, fallbackMode, derivation, deriving, deriveError } =
    state;

  const updateDerivation = (patch: Partial<ProductDerivation>) => {
    onChange((prev) =>
      prev.derivation
        ? { ...prev, derivation: { ...prev.derivation, ...patch } }
        : prev
    );
  };

  const canDeriveUrl = url.trim().length > 0 && !deriving;

  return (
    <div className="space-y-4">
      {!fallbackMode && (
        <div>
          <label
            htmlFor="product-url"
            className="block text-sm font-medium text-[var(--brand-text)] mb-1.5"
          >
            Product URL
          </label>
          <div className="flex gap-2">
            <input
              id="product-url"
              type="url"
              value={url}
              onChange={(e) =>
                onChange((prev) => ({ ...prev, url: e.target.value }))
              }
              onBlur={() => {
                if (canDeriveUrl && !derivation) onDerive({ url: url.trim() });
              }}
              placeholder="https://yourbrand.com"
              className="flex-1 px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
            />
            <button
              type="button"
              disabled={!canDeriveUrl}
              onClick={() => onDerive({ url: url.trim() })}
              className="px-4 py-2.5 rounded-lg border border-[var(--brand-blue)] text-[var(--brand-blue)] text-sm font-semibold hover:bg-[var(--brand-blue)]/[0.06] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {derivation ? "Re-read" : "Read it"}
            </button>
          </div>
        </div>
      )}

      {fallbackMode && (
        <div>
          <label
            htmlFor="product-paragraph"
            className="block text-sm font-medium text-[var(--brand-text)] mb-1.5"
          >
            Can&rsquo;t fetch that URL — describe the product instead
          </label>
          <textarea
            id="product-paragraph"
            value={paragraph}
            onChange={(e) =>
              onChange((prev) => ({ ...prev, paragraph: e.target.value }))
            }
            rows={4}
            placeholder="What you sell, what it costs, who it's for."
            className="w-full px-4 py-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all resize-none"
          />
          <div className="flex items-center justify-between mt-2">
            <button
              type="button"
              onClick={() =>
                onChange((prev) => ({ ...prev, fallbackMode: false }))
              }
              className="text-xs font-medium text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
            >
              ← Try a URL instead
            </button>
            <button
              type="button"
              disabled={paragraph.trim().length === 0 || deriving}
              onClick={() => onDerive({ paragraph: paragraph.trim() })}
              className="px-4 py-2 rounded-lg border border-[var(--brand-blue)] text-[var(--brand-blue)] text-sm font-semibold hover:bg-[var(--brand-blue)]/[0.06] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              Read it
            </button>
          </div>
        </div>
      )}

      {deriving && (
        <div className="flex items-center gap-2 text-sm text-[var(--brand-text-muted)]">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Reading your product...
        </div>
      )}

      {deriveError && (
        <div
          role="alert"
          className="p-3 rounded-lg border border-[var(--brand-warning)]/30 bg-[var(--brand-warning)]/[0.05] text-sm text-[var(--brand-text-secondary)]"
        >
          {deriveError}
        </div>
      )}

      {derivation && !deriving && (
        <div
          data-testid="read-back-card"
          className="rounded-xl border border-[var(--brand-teal)]/40 bg-[var(--brand-teal)]/[0.03] p-5 space-y-4"
        >
          <div className="text-xs uppercase tracking-wider text-[var(--brand-teal)] font-semibold">
            Here&rsquo;s what we read — correct anything that&rsquo;s off
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="derived-brand-name"
                className="block text-xs font-medium text-[var(--brand-text-muted)] mb-1"
              >
                Brand name
              </label>
              <input
                id="derived-brand-name"
                type="text"
                value={derivation.brand_name}
                onChange={(e) => updateDerivation({ brand_name: e.target.value })}
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label
                htmlFor="derived-category"
                className="block text-xs font-medium text-[var(--brand-text-muted)] mb-1"
              >
                Category
              </label>
              <input
                id="derived-category"
                type="text"
                value={derivation.category}
                onChange={(e) => updateDerivation({ category: e.target.value })}
                className={FIELD_CLASS}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="derived-description"
              className="block text-xs font-medium text-[var(--brand-text-muted)] mb-1"
            >
              Product description
            </label>
            <textarea
              id="derived-description"
              value={derivation.product_description}
              onChange={(e) =>
                updateDerivation({ product_description: e.target.value })
              }
              rows={2}
              className={`${FIELD_CLASS} resize-none`}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="derived-aov"
                className="block text-xs font-medium text-[var(--brand-text-muted)] mb-1"
              >
                Average order value
              </label>
              <select
                id="derived-aov"
                value={derivation.aov_bucket}
                onChange={(e) =>
                  updateDerivation({ aov_bucket: e.target.value as AovBucket })
                }
                className={FIELD_CLASS}
              >
                {(Object.keys(AOV_LABELS) as AovBucket[]).map((bucket) => (
                  <option key={bucket} value={bucket}>
                    {AOV_LABELS[bucket]}
                  </option>
                ))}
              </select>
              {derivation.aov_reasoning && (
                <details className="mt-1.5">
                  <summary className="text-xs text-[var(--brand-text-muted)] cursor-pointer hover:text-[var(--brand-text)]">
                    Why this bucket?
                  </summary>
                  <p className="text-xs text-[var(--brand-text-secondary)] mt-1">
                    {derivation.aov_reasoning}
                  </p>
                </details>
              )}
            </div>
            <div>
              <label
                htmlFor="derived-attributes"
                className="block text-xs font-medium text-[var(--brand-text-muted)] mb-1"
              >
                Key attributes (comma-separated)
              </label>
              <input
                id="derived-attributes"
                type="text"
                value={derivation.key_attributes.join(", ")}
                onChange={(e) =>
                  updateDerivation({
                    key_attributes: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className={FIELD_CLASS}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
