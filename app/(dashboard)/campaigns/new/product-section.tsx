"use client";

// Section 1 of the brief intake: product URL → AI derivation → editable
// read-back card. Falls back to a paste-a-paragraph textarea when the URL
// can't be fetched (paywall, 404, timeout) or derivation fails.

import type { AovBucket, ProductDerivation } from "@/lib/data/types";
import { tokens } from "@/lib/brand/tokens";

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
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";

const controlClass =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2.5 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";

const radiusStyle = { borderRadius: tokens.radius };

const labelClass = "mb-1.5 block text-sm font-medium";

const secondaryBtnClass =
  "border border-[var(--ts-hairline-on-paper)] text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)] disabled:cursor-not-allowed disabled:opacity-40";

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
          <label htmlFor="product-url" className={labelClass}>
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
              className={`min-w-0 flex-1 ${controlClass}`}
              style={radiusStyle}
            />
            <button
              type="button"
              disabled={!canDeriveUrl}
              onClick={() => onDerive({ url: url.trim() })}
              className={`px-4 py-2.5 ${secondaryBtnClass}`}
              style={radiusStyle}
            >
              {derivation ? "Re-read" : "Read it"}
            </button>
          </div>
        </div>
      )}

      {fallbackMode && (
        <div>
          <label htmlFor="product-paragraph" className={labelClass}>
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
            className={`w-full resize-none ${controlClass}`}
            style={radiusStyle}
          />
          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() =>
                onChange((prev) => ({ ...prev, fallbackMode: false }))
              }
              className="text-xs font-medium text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
            >
              ← Try a URL instead
            </button>
            <button
              type="button"
              disabled={paragraph.trim().length === 0 || deriving}
              onClick={() => onDerive({ paragraph: paragraph.trim() })}
              className={`px-4 py-2 ${secondaryBtnClass}`}
              style={radiusStyle}
            >
              Read it
            </button>
          </div>
        </div>
      )}

      {deriving && (
        <div className="flex items-center gap-2 text-sm text-[var(--ts-ink-muted-on-paper)]">
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
          className="border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-3 text-sm"
          style={radiusStyle}
        >
          {deriveError}
        </div>
      )}

      {derivation && !deriving && (
        <div
          data-testid="read-back-card"
          className="space-y-4 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-5"
          style={radiusStyle}
        >
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--ts-ink-muted-on-paper)]">
            Here&rsquo;s what we read — correct anything that&rsquo;s off
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="derived-brand-name"
                className="mb-1 block text-xs font-medium text-[var(--ts-ink-muted-on-paper)]"
              >
                Brand name
              </label>
              <input
                id="derived-brand-name"
                type="text"
                value={derivation.brand_name}
                onChange={(e) => updateDerivation({ brand_name: e.target.value })}
                className={FIELD_CLASS}
                style={radiusStyle}
              />
            </div>
            <div>
              <label
                htmlFor="derived-category"
                className="mb-1 block text-xs font-medium text-[var(--ts-ink-muted-on-paper)]"
              >
                Category
              </label>
              <input
                id="derived-category"
                type="text"
                value={derivation.category}
                onChange={(e) => updateDerivation({ category: e.target.value })}
                className={FIELD_CLASS}
                style={radiusStyle}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="derived-description"
              className="mb-1 block text-xs font-medium text-[var(--ts-ink-muted-on-paper)]"
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
              style={radiusStyle}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="derived-aov"
                className="mb-1 block text-xs font-medium text-[var(--ts-ink-muted-on-paper)]"
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
                style={radiusStyle}
              >
                {(Object.keys(AOV_LABELS) as AovBucket[]).map((bucket) => (
                  <option key={bucket} value={bucket}>
                    {AOV_LABELS[bucket]}
                  </option>
                ))}
              </select>
              {derivation.aov_reasoning && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-xs text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]">
                    Why this bucket?
                  </summary>
                  <p className="mt-1 text-xs text-[var(--ts-ink-muted-on-paper)]">
                    {derivation.aov_reasoning}
                  </p>
                </details>
              )}
            </div>
            <div>
              <label
                htmlFor="derived-attributes"
                className="mb-1 block text-xs font-medium text-[var(--ts-ink-muted-on-paper)]"
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
                style={radiusStyle}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
