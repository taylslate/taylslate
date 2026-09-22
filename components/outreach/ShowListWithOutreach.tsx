"use client";

// Per-show "Reach Out" list. Shows status pills for any outreach already sent
// in this campaign. Pulls fresh state on mount and after each send.

import { useMemo, useState } from "react";
import type { Outreach, OutreachResponseStatus, ScoredShowRecord, MediaPlanLineItem, Placement } from "@/lib/data/types";
import { tokens } from "@/lib/brand/tokens";
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

const radiusStyle = { borderRadius: tokens.radius };

const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const hairlineRule = "border-[var(--ts-hairline-on-paper)]";
const panelClass =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]";
const inkBtnClass =
  "inline-flex items-center justify-center bg-[var(--ts-ink-on-paper)] px-4 py-2 text-xs font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";

const STATUS_LABEL: Record<OutreachResponseStatus, string> = {
  pending: "Awaiting reply",
  accepted: "Accepted",
  countered: "Counter received",
  declined: "Declined",
  no_response: "No response",
};

const STATUS_COLOR: Record<OutreachResponseStatus, string> = {
  pending: "bg-[var(--ts-band-shows)] text-[var(--ts-ink-muted-on-paper)]",
  accepted: "bg-[var(--ts-band-brands)] text-[var(--ts-ink-on-paper)]",
  countered: "bg-[var(--ts-band-shows)] text-[var(--ts-ink-on-paper)]",
  declined: `bg-[var(--ts-paper)] text-[var(--ts-ink-muted-on-paper)] border ${hairlineRule}`,
  no_response: `bg-[var(--ts-paper)] text-[var(--ts-ink-muted-on-paper)] border ${hairlineRule}`,
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
              className={`flex items-center gap-4 px-4 py-3 ${panelClass}`}
              style={radiusStyle}
            >
              <div
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden border bg-[var(--ts-band-shows)] ${hairlineRule}`}
                style={radiusStyle}
              >
                {show.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={show.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className={`text-xs font-medium ${mutedText}`}>
                    {show.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className={`truncate text-sm font-medium ${inkText}`}>{show.name}</div>
                <div className={`truncate text-xs ${mutedText}`}>
                  {show.audienceSize.toLocaleString()} downloads · ${show.estimatedCpm.toFixed(2)} CPM
                  {show.contactEmail ? ` · ${show.contactEmail}` : ""}
                </div>
              </div>

              {existing ? (
                <div className="flex items-center gap-3">
                  <span
                    className={`px-2.5 py-1 text-xs font-medium ${STATUS_COLOR[existing.response_status]}`}
                    style={radiusStyle}
                  >
                    {STATUS_LABEL[existing.response_status]}
                  </span>
                  {existing.response_status === "countered" && existing.counter_cpm != null && (
                    <span className={`text-xs tabular-nums ${mutedText}`}>
                      ${existing.counter_cpm.toFixed(2)}
                    </span>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setComposerShow(composerShow)}
                  disabled={!composerShow.contact_email}
                  title={!composerShow.contact_email ? "No contact email on file" : "Send outreach"}
                  className={inkBtnClass}
                  style={radiusStyle}
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
