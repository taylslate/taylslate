"use client";

import {
  SHOW_SURFACE_TYPES,
  SURFACE_TYPE_LABELS,
  emptySurfaceDraft,
  type ShowSurfaceDraft,
  type ShowSurfaceType,
  type SurfacePostingOwner,
} from "@/lib/shows/surfaces";

const MAX_ROWS = 8;

const inputClass =
  "w-full rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] focus:outline-none";

const labelClass =
  "mb-1 block text-xs font-medium uppercase tracking-wider text-[var(--ts-ink-muted-on-paper)]";

function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default function SurfaceEditor({
  drafts,
  onChange,
}: {
  drafts: ShowSurfaceDraft[];
  onChange: (next: ShowSurfaceDraft[]) => void;
}) {
  const update = (index: number, patch: Partial<ShowSurfaceDraft>) =>
    onChange(drafts.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));

  const remove = (index: number) => onChange(drafts.filter((_, i) => i !== index));

  return (
    <div className="space-y-4">
      {drafts.length === 0 && (
        <p className="text-sm text-[var(--ts-ink-muted-on-paper)]">
          No extra surfaces yet. The podcast or YouTube read stays the buy. Add a newsletter, social, or community mention if you sell one with it.
        </p>
      )}
      {drafts.map((draft, index) => (
        <fieldset
          key={index}
          className="space-y-3 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <legend className="text-xs font-medium uppercase tracking-wider text-[var(--ts-ink-muted-on-paper)]">
              Surface {index + 1}
            </legend>
            <button
              type="button"
              onClick={() => remove(index)}
              aria-label={`Remove surface ${index + 1}`}
              className="rounded-[var(--ts-radius)] p-1.5 text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-accent-text)]"
            >
              Remove
            </button>
          </div>

          <div>
            <label className={labelClass} htmlFor={`surface-type-${index}`}>
              Type
            </label>
            <select
              id={`surface-type-${index}`}
              value={draft.type}
              onChange={(e) => update(index, { type: e.target.value as ShowSurfaceType })}
              className={inputClass}
            >
              {SHOW_SURFACE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {SURFACE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor={`surface-audience-${index}`}>
                Audience
              </label>
              <input
                id={`surface-audience-${index}`}
                type="number"
                min="0"
                value={draft.audience_size ?? ""}
                onChange={(e) => update(index, { audience_size: numberOrNull(e.target.value) })}
                placeholder="Subscribers or followers"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`surface-price-${index}`}>
                Price
              </label>
              <input
                id={`surface-price-${index}`}
                type="number"
                min="0"
                step="0.01"
                value={draft.price ?? ""}
                onChange={(e) => update(index, { price: numberOrNull(e.target.value) })}
                placeholder="USD"
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor={`surface-format-${index}`}>
                Format
              </label>
              <input
                id={`surface-format-${index}`}
                type="text"
                value={draft.format ?? ""}
                onChange={(e) => update(index, { format: e.target.value })}
                placeholder="Dedicated send, 15s clip"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`surface-min-${index}`}>
                Suggested minimum
              </label>
              <input
                id={`surface-min-${index}`}
                type="number"
                min="0"
                step="0.01"
                value={draft.min_buy ?? ""}
                onChange={(e) => update(index, { min_buy: numberOrNull(e.target.value) })}
                placeholder="Guidance, not a cutoff"
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor={`surface-lead-${index}`}>
                Lead time (days)
              </label>
              <input
                id={`surface-lead-${index}`}
                type="number"
                min="0"
                value={draft.lead_time_days ?? ""}
                onChange={(e) => update(index, { lead_time_days: numberOrNull(e.target.value) })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`surface-poster-${index}`}>
                Who posts
              </label>
              <select
                id={`surface-poster-${index}`}
                value={draft.posting_owner}
                onChange={(e) =>
                  update(index, { posting_owner: e.target.value as SurfacePostingOwner })
                }
                className={inputClass}
              >
                <option value="creator">Creator posts</option>
                <option value="brand">Brand posts</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor={`surface-constraints-${index}`}>
              Creative constraints
            </label>
            <input
              id={`surface-constraints-${index}`}
              type="text"
              value={draft.creative_constraints ?? ""}
              onChange={(e) => update(index, { creative_constraints: e.target.value })}
              placeholder="What the brand needs to know before they buy"
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor={`surface-notes-${index}`}>
              Notes
            </label>
            <input
              id={`surface-notes-${index}`}
              type="text"
              value={draft.notes ?? ""}
              onChange={(e) => update(index, { notes: e.target.value })}
              className={inputClass}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-[var(--ts-ink-on-paper)]">
            <input
              type="checkbox"
              checked={draft.published}
              onChange={(e) => update(index, { published: e.target.checked })}
            />
            List this for brands
          </label>
        </fieldset>
      ))}

      {drafts.length < MAX_ROWS && (
        <button
          type="button"
          onClick={() => onChange([...drafts, emptySurfaceDraft()])}
          className="text-sm font-medium text-[var(--ts-accent-text)] hover:opacity-80"
        >
          + Add a surface
        </button>
      )}
    </div>
  );
}
