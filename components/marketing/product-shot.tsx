import { tokens } from "@/lib/brand/tokens";
import { LAUNCH } from "@/lib/marketing/launch-copy";

const shot = LAUNCH.product;

function ScoreBar({ value }: { value: number }) {
  return (
    <div
      className="mt-1 h-1 bg-[var(--ts-hairline-on-paper)]"
      style={{ borderRadius: tokens.radius }}
    >
      <div
        className="h-full bg-[var(--ts-accent)]"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

export function ProductShot() {
  return (
    <figure id={shot.id} className="mt-14">
      <div className="overflow-hidden border border-[var(--ts-ink-on-paper)]/10 bg-[var(--ts-field)] p-2 sm:p-3" style={{ borderRadius: tokens.radius }}>
        <div className="flex items-center gap-2 px-2 pb-2" aria-hidden="true">
          <span className="h-2 w-2 rounded-full bg-[var(--ts-ink)]/40" />
          <span className="h-2 w-2 rounded-full bg-[var(--ts-ink)]/25" />
          <span className="h-2 w-2 rounded-full bg-[var(--ts-ink)]/15" />
          <span className="pl-2 text-[11px] tracking-wide text-[var(--ts-ink-muted)]">
            {shot.windowTitle}
          </span>
        </div>
        <div className="overflow-x-auto">
          <div
            aria-hidden="true"
            className="flex bg-[var(--ts-paper)] text-[var(--ts-ink-on-paper)] lg:min-w-[760px]"
            style={{ borderRadius: tokens.radius }}
          >
            <div className="hidden w-[168px] shrink-0 flex-col border-r border-[var(--ts-hairline-on-paper)] lg:flex">
              <div className="ts-wordmark border-b border-[var(--ts-hairline-on-paper)] px-4 py-4 text-[15px] tracking-tight">
                taylslate
              </div>
              <div className="px-3 pt-3">
                <div
                  className="bg-[var(--ts-accent)] px-2 py-2 text-center text-xs font-medium text-[var(--ts-accent-foreground)]"
                  style={{ borderRadius: tokens.radius }}
                >
                  {shot.newCampaign}
                </div>
              </div>
              <div className="flex flex-col gap-0.5 px-3 py-3 text-sm">
                {shot.nav.map((item) => {
                  const active = item === shot.activeNav;
                  return (
                    <div
                      key={item}
                      className={
                        active
                          ? "bg-[var(--ts-band-brands)] px-2.5 py-2 font-medium shadow-[inset_3px_0_0_var(--ts-gold)]"
                          : "px-2.5 py-2 text-[var(--ts-ink-muted-on-paper)]"
                      }
                      style={{ borderRadius: tokens.radius }}
                    >
                      {item}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="min-w-0 flex-1 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--ts-accent-text)]">
                    {shot.campaignKicker}
                  </p>
                  <p className="mt-1 text-lg font-semibold tracking-tight">
                    {shot.campaignTitle}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--ts-ink-muted-on-paper)]">
                    {shot.budgetLabel}
                  </p>
                  <p className="mt-1 text-sm font-semibold">{shot.budget}</p>
                </div>
              </div>

              <div className="mt-4 border border-[var(--ts-hairline-on-paper)]" style={{ borderRadius: tokens.radius }}>
                <div className="flex items-baseline gap-3 border-b border-[var(--ts-hairline-on-paper)] px-4 py-3">
                  <p className="text-sm font-semibold">{shot.portfolio}</p>
                  <p className="text-xs text-[var(--ts-ink-muted-on-paper)]">
                    {shot.portfolioMeta}
                  </p>
                  <p className="text-xs text-[var(--ts-ink-muted-on-paper)]">
                    {shot.portfolioNote}
                  </p>
                </div>
                <div className="divide-y divide-[var(--ts-hairline-on-paper)]">
                  {shot.shows.map((show) => (
                    <div
                      key={show.name}
                      className="grid grid-cols-1 gap-3 px-4 py-3 lg:grid-cols-[1.4fr_0.8fr_0.9fr_auto] lg:items-center lg:gap-4"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-shows)] text-xs font-semibold"
                          style={{ borderRadius: tokens.radius }}
                        >
                          {show.initials}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{show.name}</p>
                          <p className="text-[11px] text-[var(--ts-ink-muted-on-paper)]">
                            {show.band}
                          </p>
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] text-[var(--ts-ink-muted-on-paper)]">
                          {shot.audienceLabel}
                        </p>
                        <p className="mt-1 text-[11px] italic text-[var(--ts-ink-muted-on-paper)]">
                          {shot.audienceValue}
                        </p>
                      </div>
                      <div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-[var(--ts-ink-muted-on-paper)]">
                            {shot.topicalLabel}
                          </span>
                          <span className="font-semibold">{show.topical}</span>
                        </div>
                        <ScoreBar value={show.topical} />
                        <div className="mt-2 flex items-center justify-between text-[11px]">
                          <span className="text-[var(--ts-ink-muted-on-paper)]">
                            {shot.purchaseLabel}
                          </span>
                          <span className="font-semibold">{show.purchase}</span>
                        </div>
                        <ScoreBar value={show.purchase} />
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{show.price}</p>
                        <p className="text-[11px] text-[var(--ts-ink-muted-on-paper)]">
                          {shot.priceLabel}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
        {shot.caption}
      </figcaption>
    </figure>
  );
}
