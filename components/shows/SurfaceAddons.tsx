import {
  formatSurfacePrice,
  postingOwnerLabel,
  surfaceMinBuyNote,
  surfaceTypeLabel,
  type SellableSurface,
} from "@/lib/shows/surfaces";

/** Read-only add-ons on a discovery card. They do not change the score or the selection. */
export default function SurfaceAddons({ surfaces }: { surfaces: SellableSurface[] }) {
  const listed = surfaces.filter((surface) => surface.published);
  if (listed.length === 0) return null;
  return (
    <div data-testid="surface-addons" className="mt-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--ts-ink-muted-on-paper)]">
        Add-ons on this show
      </div>
      <ul className="mt-1 space-y-1">
        {listed.map((surface) => {
          const note = surfaceMinBuyNote(surface.min_buy);
          return (
            <li key={surface.id} className="text-xs text-[var(--ts-ink-on-paper)]">
              <span className="font-medium">{surfaceTypeLabel(surface.type)}</span>
              <span className="text-[var(--ts-ink-muted-on-paper)]">
                {" "}
                · {formatSurfacePrice(surface.price)} · {postingOwnerLabel(surface.posting_owner)}
              </span>
              {note && (
                <span className="block text-[var(--ts-ink-muted-on-paper)]">{note}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
