"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { Deal, DealStatus } from "@/lib/data";
import { tokens } from "@/lib/brand/tokens";

type ColumnKey = "planning" | "io_sent" | "live" | "completed";

const pipelineColumns: { key: ColumnKey; label: string }[] = [
  { key: "planning", label: "Planning" },
  { key: "io_sent", label: "IO Sent" },
  { key: "live", label: "Live" },
  { key: "completed", label: "Completed" },
];

// Every deal status (Wave-12 signing lifecycle + legacy migration-001 values)
// buckets into one of the 4 board columns, so a deal is never silently dropped
// from the board while still counting in the totals above it.
const statusToColumn: Record<string, ColumnKey> = {
  planning: "planning",
  io_sent: "io_sent",
  brand_signed: "io_sent",
  show_signed: "io_sent",
  live: "live",
  delivering: "live",
  completed: "completed",
  cancelled: "completed",
  // legacy values that may exist on older rows
  proposed: "planning",
  negotiating: "planning",
  approved: "io_sent",
  signed: "io_sent",
};

const columnOf = (status: string): ColumnKey => statusToColumn[status] ?? "planning";

const statusLabels: Record<string, string> = {
  planning: "Planning",
  io_sent: "IO Sent",
  brand_signed: "Brand Signed",
  show_signed: "Show Signed",
  live: "Live",
  delivering: "Delivering",
  completed: "Completed",
  cancelled: "Cancelled",
};

const radiusStyle = { borderRadius: tokens.radius };

const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const accentText = "text-[var(--ts-accent)]";
const hairlineRule = "border-[var(--ts-hairline-on-paper)]";
const panelClass = "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]";
const inkBtnClass =
  "inline-flex items-center gap-2 bg-[var(--ts-ink-on-paper)] px-4 py-2.5 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90";
const ghostBtnClass =
  "inline-flex items-center gap-2 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2.5 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)]";
const kickerClass =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent)]";
const pulseClass = "animate-pulse bg-[var(--ts-ink-on-paper)]/10";

function statusChipClass(status: string): string {
  switch (status) {
    case "show_signed":
    case "live":
    case "delivering":
      return "bg-[var(--ts-band-brands)] text-[var(--ts-ink-on-paper)]";
    case "io_sent":
    case "brand_signed":
    case "approved":
    case "signed":
      return `bg-[var(--ts-band-shows)] ${inkText}`;
    case "completed":
    case "cancelled":
      return `border ${hairlineRule} bg-[var(--ts-paper)] ${mutedText}`;
    default:
      return `bg-[var(--ts-band-shows)] ${mutedText}`;
  }
}

function DealCard({
  deal,
  onDragStart,
}: {
  deal: Deal & { show_name?: string; image_url?: string };
  onDragStart: (e: React.DragEvent, dealId: string) => void;
}) {
  const showName = deal.show_name ?? "Unknown Show";
  const initial = showName.charAt(0).toUpperCase();

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, deal.id)}
      className={`${panelClass} cursor-grab p-4 active:cursor-grabbing`}
      style={radiusStyle}
    >
      {/* Show name + image */}
      <div className="mb-3 flex items-center gap-3">
        {deal.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={deal.image_url}
            alt={showName}
            className={`h-9 w-9 flex-shrink-0 border object-cover ${hairlineRule}`}
            style={radiusStyle}
          />
        ) : (
          <div
            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center border bg-[var(--ts-band-shows)] text-sm font-medium ${hairlineRule} ${mutedText}`}
            style={radiusStyle}
          >
            {initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <Link
            href={`/deals/${deal.id}`}
            className={`block truncate text-sm font-medium ${inkText} hover:text-[var(--ts-accent)]`}
            onClick={(e) => e.stopPropagation()}
          >
            {showName}
          </Link>
          {((deal as unknown as Record<string, unknown>).brand_name as string) ? (
            <span className={`block truncate text-xs ${mutedText}`}>
              {(deal as unknown as Record<string, unknown>).brand_name as string}
            </span>
          ) : null}
        </div>
        <span
          className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-medium ${statusChipClass(deal.status)}`}
          style={radiusStyle}
        >
          {statusLabels[deal.status] ?? deal.status}
        </span>
      </div>

      {/* Budget + CPM */}
      <div className="mb-2 flex items-center justify-between">
        <span className={`text-sm font-medium tabular-nums ${inkText}`}>
          ${deal.total_net.toLocaleString()}
        </span>
        <span className={`text-xs ${mutedText}`}>
          {deal.price_type === "flat_rate"
            ? "Flat fee"
            : `$${deal.cpm_rate} CPM`}
        </span>
      </div>

      {/* Episodes + Placement */}
      <div className={`flex items-center gap-2 border-t pt-2 ${hairlineRule}`}>
        <span className={`text-xs ${mutedText}`}>
          {deal.num_episodes} ep{deal.num_episodes !== 1 ? "s" : ""} · {deal.placement}
        </span>
        {["io_sent", "brand_signed", "show_signed", "live", "delivering", "completed"].includes(deal.status) && (
          <Link
            href={`/deals/${deal.id}/io`}
            className={`ml-auto text-xs font-medium ${accentText} hover:underline`}
            onClick={(e) => e.stopPropagation()}
          >
            View IO
          </Link>
        )}
      </div>
    </div>
  );
}

export default function DealsPage() {
  const [dealList, setDealList] = useState<Deal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [, setDraggedDealId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/deals")
      .then((res) => res.json())
      .then((data) => setDealList(data.deals))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  function handleDragStart(e: React.DragEvent, dealId: string) {
    e.dataTransfer.setData("text/plain", dealId);
    e.dataTransfer.effectAllowed = "move";
    setDraggedDealId(dealId);
  }

  function handleDragOver(e: React.DragEvent, columnKey: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(columnKey);
  }

  function handleDragLeave() {
    setDragOverColumn(null);
  }

  async function handleDrop(e: React.DragEvent, columnKey: string) {
    e.preventDefault();
    const dealId = e.dataTransfer.getData("text/plain");
    const newStatus = columnKey as DealStatus;
    const oldDeal = dealList.find((d) => d.id === dealId);
    if (!oldDeal || oldDeal.status === newStatus) {
      setDragOverColumn(null);
      setDraggedDealId(null);
      return;
    }

    // Optimistic update
    setDealList((prev) =>
      prev.map((d) => (d.id === dealId ? { ...d, status: newStatus } : d))
    );
    setDragOverColumn(null);
    setDraggedDealId(null);

    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        setDealList((prev) =>
          prev.map((d) => (d.id === dealId ? { ...d, status: oldDeal.status } : d))
        );
      }
    } catch {
      setDealList((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, status: oldDeal.status } : d))
      );
    }
  }

  function handleDragEnd() {
    setDragOverColumn(null);
    setDraggedDealId(null);
  }

  const totalValue = dealList.reduce((s, d) => s + d.total_net, 0);

  if (isLoading) {
    return (
      <div className="p-4 sm:p-8">
        <div className="mb-8">
          <div className={`mb-2 h-3 w-20 ${pulseClass}`} style={radiusStyle} />
          <div className={`mb-2 h-7 w-40 ${pulseClass}`} style={radiusStyle} />
          <div className={`h-4 w-72 ${pulseClass}`} style={radiusStyle} />
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={`h-64 ${panelClass} ${pulseClass}`} style={radiusStyle} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={kickerClass}>For brands</p>
          <h1 className={`mt-2 text-2xl font-semibold tracking-tight ${inkText}`}>Deal Pipeline</h1>
          <p className={`mt-1 text-sm ${mutedText}`}>
            Drag deals between columns to update their status.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/deals/import"
            className={ghostBtnClass}
            style={radiusStyle}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Import IO
          </Link>
          <Link
            href="/deals/new"
            className={inkBtnClass}
            style={radiusStyle}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Deal
          </Link>
        </div>
      </div>

      {/* Summary Bar */}
      <div
        className={`mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 p-4 ${panelClass}`}
        style={radiusStyle}
      >
        <div>
          <div className={`text-lg font-semibold tabular-nums ${inkText}`}>{dealList.length}</div>
          <div className={`text-xs ${mutedText}`}>Total Deals</div>
        </div>
        <div className={`hidden h-8 w-px sm:block ${hairlineRule} bg-[var(--ts-hairline-on-paper)]`} />
        <div>
          <div className={`text-lg font-semibold tabular-nums ${inkText}`}>${totalValue.toLocaleString()}</div>
          <div className={`text-xs ${mutedText}`}>Pipeline Value</div>
        </div>
        <div className={`hidden h-8 w-px sm:block bg-[var(--ts-hairline-on-paper)]`} />
        {pipelineColumns.map((col) => {
          const count = dealList.filter((d) => columnOf(d.status) === col.key).length;
          return (
            <div key={col.key}>
              <span className={`text-xs ${mutedText}`}>
                {col.label}: <span className={`font-medium ${inkText}`}>{count}</span>
              </span>
            </div>
          );
        })}
      </div>

      {/* Kanban Board */}
      {dealList.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {pipelineColumns.map((col) => {
            const columnDeals = dealList.filter((d) => columnOf(d.status) === col.key);
            const columnValue = columnDeals.reduce((s, d) => s + d.total_net, 0);
            const isOver = dragOverColumn === col.key;

            return (
              <div
                key={col.key}
                onDragOver={(e) => handleDragOver(e, col.key)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.key)}
                onDragEnd={handleDragEnd}
                className={`flex min-h-[400px] flex-col border ${hairlineRule} ${
                  isOver ? "bg-[var(--ts-band-brands)]" : "bg-[var(--ts-paper)]"
                }`}
                style={radiusStyle}
              >
                {/* Column Header */}
                <div className={`border-b p-3 ${hairlineRule}`}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className={`text-sm font-medium ${inkText}`}>
                      {col.label}
                    </span>
                    <span className={`text-xs font-medium tabular-nums ${mutedText}`}>
                      {columnDeals.length}
                    </span>
                  </div>
                  {columnDeals.length > 0 && (
                    <div className={`text-xs tabular-nums ${mutedText}`}>
                      ${columnValue.toLocaleString()}
                    </div>
                  )}
                </div>

                {/* Cards */}
                <div className="flex-1 space-y-2 overflow-y-auto p-2">
                  {columnDeals.map((deal) => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      onDragStart={handleDragStart}
                    />
                  ))}
                  {columnDeals.length === 0 && (
                    <div className={`flex h-full items-center justify-center text-xs italic ${mutedText}`}>
                      No deals
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={`${panelClass} px-6 py-16 text-center`} style={radiusStyle}>
          <h3 className={`mb-2 text-lg font-semibold ${inkText}`}>No deals yet</h3>
          <p className={`mx-auto max-w-sm text-sm ${mutedText}`}>
            Deals will appear here as brands reach out to sponsor your shows.
          </p>
        </div>
      )}
    </div>
  );
}
