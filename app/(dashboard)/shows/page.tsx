import { getAgentShows } from "@/lib/data";

const agentShows = getAgentShows("user-agent-001");

export default function ShowsPage() {
  const hasShows = agentShows.length > 0;

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">Shows</h1>
          <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
            Manage the podcasts and YouTube channels you represent.
          </p>
        </div>
      </div>

      {hasShows ? (
        <div className="space-y-3">
          {agentShows.map((show) => {
            const isPodcast = show.platform === "podcast";
            const displayRate = isPodcast
              ? show.rate_card.midroll_cpm
                ? `$${show.rate_card.midroll_cpm}`
                : "—"
              : show.rate_card.flat_rate
                ? `$${show.rate_card.flat_rate.toLocaleString()}`
                : "—";
            const rateLabel = isPodcast ? "mid-roll CPM" : "flat rate";
            const audienceLabel = isPodcast ? "downloads/ep" : "avg views";
            const slotsAvailable = show.available_slots != null && show.available_slots > 0;

            return (
              <div
                key={show.id}
                className="flex items-center justify-between p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] hover:border-[var(--brand-blue)]/30 hover:shadow-sm transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    isPodcast
                      ? "bg-gradient-to-br from-[var(--brand-blue)]/10 to-[var(--brand-teal)]/10"
                      : "bg-gradient-to-br from-[var(--brand-error)]/10 to-[var(--brand-orange)]/10"
                  }`}>
                    {isPodcast ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" x2="12" y1="19" y2="22" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-error)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="23 7 16 12 23 17 23 7" />
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                      </svg>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-[var(--brand-text)]">{show.name}</h3>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                        isPodcast
                          ? "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]"
                          : "bg-[var(--brand-error)]/10 text-[var(--brand-error)]"
                      }`}>
                        {show.platform}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-[var(--brand-text-muted)]">
                        {show.audience_size >= 1000
                          ? `${(show.audience_size / 1000).toFixed(show.audience_size >= 10000 ? 0 : 1)}K`
                          : show.audience_size} {audienceLabel}
                      </span>
                      <span className="text-xs text-[var(--brand-text-muted)]">
                        {show.categories.slice(0, 2).join(", ")}
                      </span>
                      {show.commission_rate != null && (
                        <span className="text-xs text-[var(--brand-text-muted)]">
                          {(show.commission_rate * 100).toFixed(0)}% commission
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-5">
                  <div className="text-right">
                    <div className="text-sm font-semibold text-[var(--brand-text)]">{displayRate}</div>
                    <div className="text-xs text-[var(--brand-text-muted)]">{rateLabel}</div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                    slotsAvailable
                      ? "bg-[var(--brand-teal)]/10 text-[var(--brand-teal)]"
                      : "bg-[var(--brand-text-muted)]/10 text-[var(--brand-text-muted)]"
                  }`}>
                    {slotsAvailable ? `${show.available_slots} slots` : "Full"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 bg-[var(--brand-surface-elevated)] rounded-2xl border border-[var(--brand-border)] border-dashed">
          <div className="w-16 h-16 rounded-2xl bg-[var(--brand-blue)]/[0.06] flex items-center justify-center mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-[var(--brand-text)] mb-2">No shows yet</h3>
          <p className="text-sm text-[var(--brand-text-muted)] mb-6 max-w-sm text-center">
            Shows you represent will appear here.
          </p>
        </div>
      )}
    </div>
  );
}
