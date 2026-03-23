"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { Deal, DealStatus } from "@/lib/data";

const pipelineColumns: { key: DealStatus; label: string; color: string }[] = [
  { key: "planning", label: "Planning", color: "var(--brand-blue)" },
  { key: "io_sent", label: "IO Sent", color: "var(--brand-warning)" },
  { key: "live", label: "Live", color: "var(--brand-success)" },
  { key: "completed", label: "Completed", color: "var(--brand-text-muted)" },
];

const statusBadgeStyles: Record<DealStatus, { bg: string; text: string }> = {
  planning: { bg: "rgba(59,130,246,0.1)", text: "var(--brand-blue)" },
  io_sent: { bg: "rgba(245,158,11,0.1)", text: "var(--brand-warning)" },
  live: { bg: "rgba(34,197,94,0.1)", text: "var(--brand-success)" },
  completed: { bg: "rgba(107,114,128,0.1)", text: "var(--brand-text-muted)" },
};

const statusLabels: Record<DealStatus, string> = {
  planning: "Planning",
  io_sent: "IO Sent",
  live: "Live",
  completed: "Completed",
};

function DealCard({
  deal,
  onDragStart,
}: {
  deal: Deal & { show_name?: string; image_url?: string };
  onDragStart: (e: React.DragEvent, dealId: string) => void;
}) {
  const showName = deal.show_name ?? "Unknown Show";
  const initial = showName.charAt(0).toUpperCase();
  const badge = statusBadgeStyles[deal.status];

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, deal.id)}
      className="p-4 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] hover:border-[var(--brand-blue)]/30 hover:shadow-sm transition-all cursor-grab active:cursor-grabbing"
    >
      {/* Show name + image */}
      <div className="flex items-center gap-3 mb-3">
        {deal.image_url ? (
          <img
            src={deal.image_url}
            alt={showName}
            className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
          />
        ) : (
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-white text-sm font-bold"
            style={{
              background: "linear-gradient(135deg, var(--brand-blue), var(--brand-teal))",
            }}
          >
            {initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <Link
            href={`/deals/${deal.id}`}
            className="text-sm font-semibold text-[var(--brand-text)] truncate block hover:text-[var(--brand-blue)] transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {showName}
          </Link>
          {((deal as unknown as Record<string, unknown>).brand_name as string) ? (
            <span className="text-xs text-[var(--brand-text-muted)] truncate block">
              {(deal as unknown as Record<string, unknown>).brand_name as string}
            </span>
          ) : null}
        </div>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: badge.bg, color: badge.text }}
        >
          {statusLabels[deal.status]}
        </span>
      </div>

      {/* Budget + CPM */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-[var(--brand-text)]">
          ${deal.total_net.toLocaleString()}
        </span>
        <span className="text-xs text-[var(--brand-text-muted)]">
          {deal.price_type === "flat_rate"
            ? "Flat fee"
            : `$${deal.cpm_rate} CPM`}
        </span>
      </div>

      {/* Episodes + Placement */}
      <div className="flex items-center gap-2 pt-2 border-t border-[var(--brand-border)]">
        <span className="text-xs text-[var(--brand-text-muted)]">
          {deal.num_episodes} ep{deal.num_episodes !== 1 ? "s" : ""} · {deal.placement}
        </span>
        {["io_sent", "live", "completed"].includes(deal.status) && (
          <Link
            href={`/deals/${deal.id}/io`}
            className="ml-auto text-xs text-[var(--brand-blue)] hover:underline font-medium"
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
  const [draggedDealId, setDraggedDealId] = useState<string | null>(null);

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
      <div className="p-8">
        <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight mb-6">Deal Pipeline</h1>
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-3 border-[var(--brand-blue)]/20 border-t-[var(--brand-blue)] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">Deal Pipeline</h1>
          <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
            Drag deals between columns to update their status.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/deals/import"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--brand-border)] text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] text-sm font-medium transition-colors"
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
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Deal
          </Link>
        </div>
      </div>

      {/* Summary Bar */}
      <div className="flex items-center gap-6 mb-6 p-4 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
        <div>
          <div className="text-lg font-bold text-[var(--brand-text)]">{dealList.length}</div>
          <div className="text-xs text-[var(--brand-text-muted)]">Total Deals</div>
        </div>
        <div className="w-px h-8 bg-[var(--brand-border)]" />
        <div>
          <div className="text-lg font-bold text-[var(--brand-text)]">${totalValue.toLocaleString()}</div>
          <div className="text-xs text-[var(--brand-text-muted)]">Pipeline Value</div>
        </div>
        <div className="w-px h-8 bg-[var(--brand-border)]" />
        {pipelineColumns.map((col) => {
          const count = dealList.filter((d) => d.status === col.key).length;
          return (
            <div key={col.key} className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: col.color }}
              />
              <span className="text-xs text-[var(--brand-text-muted)]">
                {col.label}: <span className="font-semibold text-[var(--brand-text)]">{count}</span>
              </span>
            </div>
          );
        })}
      </div>

      {/* Kanban Board */}
      {dealList.length > 0 ? (
        <div className="grid grid-cols-4 gap-4">
          {pipelineColumns.map((col) => {
            const columnDeals = dealList.filter((d) => d.status === col.key);
            const columnValue = columnDeals.reduce((s, d) => s + d.total_net, 0);
            const isOver = dragOverColumn === col.key;

            return (
              <div
                key={col.key}
                onDragOver={(e) => handleDragOver(e, col.key)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.key)}
                onDragEnd={handleDragEnd}
                className={`flex flex-col rounded-xl border transition-colors min-h-[400px] ${
                  isOver
                    ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.03]"
                    : "border-[var(--brand-border)] bg-[var(--brand-surface)]"
                }`}
              >
                {/* Column Header */}
                <div className="p-3 border-b border-[var(--brand-border)]">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: col.color }}
                      />
                      <span className="text-sm font-semibold text-[var(--brand-text)]">
                        {col.label}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-[var(--brand-text-muted)] bg-[var(--brand-surface-elevated)] px-2 py-0.5 rounded-full">
                      {columnDeals.length}
                    </span>
                  </div>
                  {columnDeals.length > 0 && (
                    <div className="text-xs text-[var(--brand-text-muted)]">
                      ${columnValue.toLocaleString()}
                    </div>
                  )}
                </div>

                {/* Cards */}
                <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                  {columnDeals.map((deal) => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      onDragStart={handleDragStart}
                    />
                  ))}
                  {columnDeals.length === 0 && (
                    <div className="flex items-center justify-center h-full text-xs text-[var(--brand-text-muted)] italic">
                      No deals
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 bg-[var(--brand-surface-elevated)] rounded-2xl border border-[var(--brand-border)] border-dashed">
          <div className="w-16 h-16 rounded-2xl bg-[var(--brand-blue)]/[0.06] flex items-center justify-center mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0C1.46 6.7 1.33 10.28 4 13l8 8 8-8c2.67-2.72 2.54-6.3.42-8.42z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-[var(--brand-text)] mb-2">No deals yet</h3>
          <p className="text-sm text-[var(--brand-text-muted)] mb-6 max-w-sm text-center">
            Deals will appear here as brands reach out to sponsor your shows.
          </p>
        </div>
      )}
    </div>
  );
}
