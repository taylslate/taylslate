"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getShowById, getIOByDeal, profiles } from "@/lib/data";
import type { Deal, DealStatus } from "@/lib/data";

// Kanban columns — approved/io_sent map into "signed"
const pipelineColumns: { key: string; label: string; statuses: DealStatus[] }[] = [
  { key: "proposed", label: "Proposed", statuses: ["proposed"] },
  { key: "negotiating", label: "Negotiating", statuses: ["negotiating"] },
  { key: "signed", label: "Signed", statuses: ["approved", "io_sent", "signed"] },
  { key: "live", label: "Live", statuses: ["live"] },
  { key: "completed", label: "Completed", statuses: ["completed"] },
];

const columnColors: Record<string, string> = {
  proposed: "var(--brand-blue)",
  negotiating: "var(--brand-warning)",
  signed: "var(--brand-success)",
  live: "var(--brand-success)",
  completed: "var(--brand-text-muted)",
};

function getBrandName(brandId: string): string {
  return profiles.find((p) => p.id === brandId)?.company_name ?? "Unknown Brand";
}

function DealCard({
  deal,
  onDragStart,
}: {
  deal: Deal;
  onDragStart: (e: React.DragEvent, dealId: string) => void;
}) {
  const show = getShowById(deal.show_id);
  const brandName = getBrandName(deal.brand_id);
  const existingIO = getIOByDeal(deal.id);
  const showIOLink = ["approved", "io_sent", "signed", "live", "completed"].includes(deal.status);
  const ioLabel = existingIO ? "View IO" : "Generate IO";
  const flightStart = new Date(deal.flight_start).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const flightEnd = new Date(deal.flight_end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, deal.id)}
      className="p-4 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] hover:border-[var(--brand-blue)]/30 hover:shadow-sm transition-all cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-center justify-between mb-2">
        <Link
          href={`/deals/${deal.id}`}
          className="text-sm font-semibold text-[var(--brand-text)] truncate hover:text-[var(--brand-blue)] transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {show?.name ?? "Unknown Show"}
        </Link>
      </div>
      <p className="text-xs text-[var(--brand-text-muted)] mb-2">{brandName}</p>
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--brand-text-muted)]">
          {flightStart} – {flightEnd}
        </span>
        <span className="text-sm font-semibold text-[var(--brand-text)]">
          ${deal.total_net.toLocaleString()}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--brand-border)]">
        <span className="text-xs text-[var(--brand-text-muted)]">
          {deal.num_episodes} ep{deal.num_episodes !== 1 ? "s" : ""} · {deal.placement}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {["live", "completed"].includes(deal.status) && existingIO && existingIO.line_items.some((li) => li.actual_post_date || li.verified) && (
            <Link
              href="/invoices"
              className="text-xs text-[var(--brand-teal)] hover:underline font-medium"
              onClick={(e) => e.stopPropagation()}
            >
              Invoice
            </Link>
          )}
          {showIOLink && (
            <Link
              href={`/deals/${deal.id}/io`}
              className="text-xs text-[var(--brand-blue)] hover:underline font-medium"
              onClick={(e) => e.stopPropagation()}
            >
              {ioLabel}
            </Link>
          )}
        </div>
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

  // Map column key to the primary status to set when dropping
  const columnDropStatus: Record<string, DealStatus> = {
    proposed: "proposed",
    negotiating: "negotiating",
    signed: "signed",
    live: "live",
    completed: "completed",
  };

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

  function handleDrop(e: React.DragEvent, columnKey: string) {
    e.preventDefault();
    const dealId = e.dataTransfer.getData("text/plain");
    const newStatus = columnDropStatus[columnKey];

    setDealList((prev) =>
      prev.map((d) => (d.id === dealId ? { ...d, status: newStatus } : d))
    );
    setDragOverColumn(null);
    setDraggedDealId(null);
  }

  function handleDragEnd() {
    setDragOverColumn(null);
    setDraggedDealId(null);
  }

  // Exclude cancelled from kanban
  const visibleDeals = dealList.filter((d) => d.status !== "cancelled");
  const totalValue = visibleDeals.reduce((s, d) => s + d.total_net, 0);

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
          <div className="text-lg font-bold text-[var(--brand-text)]">{visibleDeals.length}</div>
          <div className="text-xs text-[var(--brand-text-muted)]">Total Deals</div>
        </div>
        <div className="w-px h-8 bg-[var(--brand-border)]" />
        <div>
          <div className="text-lg font-bold text-[var(--brand-text)]">${totalValue.toLocaleString()}</div>
          <div className="text-xs text-[var(--brand-text-muted)]">Pipeline Value</div>
        </div>
        <div className="w-px h-8 bg-[var(--brand-border)]" />
        {pipelineColumns.map((col) => {
          const count = visibleDeals.filter((d) => col.statuses.includes(d.status)).length;
          return (
            <div key={col.key} className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: columnColors[col.key] }}
              />
              <span className="text-xs text-[var(--brand-text-muted)]">
                {col.label}: <span className="font-semibold text-[var(--brand-text)]">{count}</span>
              </span>
            </div>
          );
        })}
      </div>

      {/* Kanban Board */}
      {visibleDeals.length > 0 ? (
        <div className="grid grid-cols-5 gap-4">
          {pipelineColumns.map((col) => {
            const columnDeals = visibleDeals.filter((d) => col.statuses.includes(d.status));
            const columnValue = columnDeals.reduce((s, d) => s + d.total_net, 0);
            const isOver = dragOverColumn === col.key;

            return (
              <div
                key={col.key}
                onDragOver={(e) => handleDragOver(e, col.key)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.key)}
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
                        style={{ backgroundColor: columnColors[col.key] }}
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
