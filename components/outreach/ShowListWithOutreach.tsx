"use client";

// Per-show "Reach Out" list. Shows status pills for any outreach already sent
// in this campaign. Pulls fresh state on mount and after each send.

import { useMemo, useState } from "react";
import type { Outreach, OutreachResponseStatus, ScoredShowRecord, MediaPlanLineItem, Placement } from "@/lib/data/types";
import ComposerModal, { type ComposerShow } from "./ComposerModal";

interface SelectedShowEntry {
  show: ScoredShowRecord;
  line_item?: MediaPlanLineItem;
}

interface Props {
  campaignId: string;
  selectedShows: SelectedShowEntry[];
  initialOutreaches: Outreach[];
  defaultPlacement?: Placement;
  defaultEpisodes?: number;
}

const STATUS_LABEL: Record<OutreachResponseStatus, string> = {
  pending: "Awaiting reply",
  accepted: "Accepted",
  countered: "Counter received",
  declined: "Declined",
  no_response: "No response",
};

const STATUS_COLOR: Record<OutreachResponseStatus, string> = {
  pending: "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]",
  accepted: "bg-[var(--brand-success)]/10 text-[var(--brand-success)]",
  countered: "bg-[var(--brand-warning)]/10 text-[var(--brand-warning)]",
  declined: "bg-[var(--brand-text-muted)]/10 text-[var(--brand-text-muted)]",
  no_response: "bg-[var(--brand-text-muted)]/10 text-[var(--brand-text-muted)]",
};

export default function ShowListWithOutreach({
  campaignId,
  selectedShows,
  initialOutreaches,
  defaultPlacement,
  defaultEpisodes,
}: Props) {
  const [outreaches, setOutreaches] = useState<Outreach[]>(initialOutreaches);
  const [composerShow, setComposerShow] = useState<ComposerShow | null>(null);

  const byShowKey = useMemo(() => {
    const map = new Map<string, Outreach>();
    for (const o of outreaches) {
      const key = o.show_id ?? o.podscan_id ?? o.show_name;
      map.set(key, o);
    }
    return map;
  }, [outreaches]);

  const refresh = async () => {
    const res = await fetch(`/api/campaigns/${campaignId}/outreach`);
    if (res.ok) {
      const data = await res.json();
      setOutreaches(data.outreaches ?? []);
    }
  };

  return (
    <>
      <div className="space-y-2">
        {selectedShows.map(({ show, line_item }) => {
          const key = show.podcastId;
          const existing = byShowKey.get(key);
          const composerShow: ComposerShow = {
            show_id: null,
            podscan_id: show.podcastId,
            show_name: show.name,
            contact_email: show.contactEmail ?? "",
            audience_size: show.audienceSize,
            estimated_cpm: show.estimatedCpm,
            categories: show.categories,
            existing_sponsors: [],
            default_episode_count: line_item?.num_episodes ?? defaultEpisodes ?? 3,
            default_placement: line_item?.placement ?? defaultPlacement ?? "mid-roll",
          };
          return (
            <div
              key={key}
              className="flex items-center gap-4 px-4 py-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)]"
            >
              <div className="w-10 h-10 rounded-lg flex-shrink-0 overflow-hidden bg-gradient-to-br from-[var(--brand-blue)]/20 to-[var(--brand-teal)]/20 flex items-center justify-center">
                {show.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={show.imageUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs font-bold text-[var(--brand-blue)]">
                    {show.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--brand-text)] truncate">{show.name}</div>
                <div className="text-xs text-[var(--brand-text-muted)] truncate">
                  {show.audienceSize.toLocaleString()} downloads · ${show.estimatedCpm.toFixed(2)} CPM
                  {show.contactEmail ? ` · ${show.contactEmail}` : ""}
                </div>
              </div>

              {existing ? (
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLOR[existing.response_status]}`}
                  >
                    {STATUS_LABEL[existing.response_status]}
                  </span>
                  {existing.response_status === "countered" && existing.counter_cpm != null && (
                    <span className="text-xs text-[var(--brand-text-secondary)]">
                      ${existing.counter_cpm.toFixed(2)}
                    </span>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setComposerShow(composerShow)}
                  disabled={!composerShow.contact_email}
                  title={!composerShow.contact_email ? "No contact email on file" : "Send outreach"}
                  className="px-4 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold"
                >
                  Reach out
                </button>
              )}
            </div>
          );
        })}
      </div>

      {composerShow && (
        <ComposerModal
          show={composerShow}
          campaignId={campaignId}
          onClose={() => setComposerShow(null)}
          onSent={async () => {
            setComposerShow(null);
            await refresh();
          }}
        />
      )}
    </>
  );
}
