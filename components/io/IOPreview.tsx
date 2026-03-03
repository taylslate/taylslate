"use client";

import type { InsertionOrder } from "@/lib/data";

interface IOPreviewProps {
  io: Partial<InsertionOrder>;
  onEdit: () => void;
  onConfirm: () => void;
  isConfirming?: boolean;
}

const labelClass = "text-sm font-medium text-[var(--brand-text)] mb-1.5 block";
const valueClass =
  "w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)]/60 text-sm text-[var(--brand-text-secondary)]";

export default function IOPreview({ io, onEdit, onConfirm, isConfirming }: IOPreviewProps) {
  const lineItems = io.line_items ?? [];
  const totalDownloads = io.total_downloads ?? 0;
  const totalGross = io.total_gross ?? 0;
  const totalNet = io.total_net ?? 0;

  return (
    <div>
      {/* IO Number */}
      <div className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider">
              IO Number
            </span>
            <div className="text-lg font-bold text-[var(--brand-text)] mt-0.5">
              {io.io_number ?? "—"}
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]">
            Import Preview
          </span>
        </div>
      </div>

      {/* Advertiser */}
      <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-4">
          Advertiser
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Company</label>
            <div className={valueClass}>{io.advertiser_name || "—"}</div>
          </div>
          <div>
            <label className={labelClass}>Contact</label>
            <div className={valueClass}>{io.advertiser_contact_name || "—"}</div>
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Email</label>
            <div className={valueClass}>{io.advertiser_contact_email || "—"}</div>
          </div>
        </div>
      </section>

      {/* Publisher */}
      <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-4">
          Publisher
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Company</label>
            <div className={valueClass}>{io.publisher_name || "—"}</div>
          </div>
          <div>
            <label className={labelClass}>Contact</label>
            <div className={valueClass}>{io.publisher_contact_name || "—"}</div>
          </div>
          <div>
            <label className={labelClass}>Email</label>
            <div className={valueClass}>{io.publisher_contact_email || "—"}</div>
          </div>
          {io.publisher_address && (
            <div>
              <label className={labelClass}>Address</label>
              <div className={valueClass}>{io.publisher_address}</div>
            </div>
          )}
        </div>
      </section>

      {/* Agency (conditional) */}
      {io.agency_name && (
        <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
          <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-4">
            Agency
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Company</label>
              <div className={valueClass}>{io.agency_name}</div>
            </div>
            <div>
              <label className={labelClass}>Contact</label>
              <div className={valueClass}>{io.agency_contact_name || "—"}</div>
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <div className={valueClass}>{io.agency_contact_email || "—"}</div>
            </div>
            {io.send_invoices_to && (
              <div>
                <label className={labelClass}>Send Invoices To</label>
                <div className={valueClass}>{io.send_invoices_to}</div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Line Items */}
      <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-4">
          Line Items
        </h2>
        <div className="space-y-3">
          {lineItems.map((item, index) => (
            <div
              key={item.id}
              className="p-4 bg-[var(--brand-surface)] rounded-lg border border-[var(--brand-border)]/50"
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--brand-blue)]/10 text-xs font-bold text-[var(--brand-blue)]">
                  {index + 1}
                </span>
                <span className="text-sm font-medium text-[var(--brand-text)]">
                  {item.show_name || "Untitled Show"}
                </span>
                <span className="text-xs text-[var(--brand-text-muted)] bg-[var(--brand-surface-elevated)] px-2 py-0.5 rounded">
                  {item.placement} &middot; {item.reader_type.replace("_", " ")}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className={labelClass}>Post Date</label>
                  <div className={valueClass}>
                    {item.post_date
                      ? new Date(item.post_date).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "—"}
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Guaranteed DLs</label>
                  <div className={valueClass}>
                    {item.guaranteed_downloads.toLocaleString()}
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Gross Rate</label>
                  <div className={valueClass}>
                    $
                    {item.gross_rate.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Net Due</label>
                  <div className="w-full px-3 py-2 rounded-lg border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/[0.04] text-sm font-semibold text-[var(--brand-blue)]">
                    $
                    {item.net_due.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-[var(--brand-text-muted)]">
                <span>
                  {item.price_type === "cpm"
                    ? `$${item.gross_cpm} CPM`
                    : "Flat rate"}
                </span>
                <span>{item.is_scripted ? "Scripted" : "Organic"}</span>
                <span>
                  {item.is_personal_experience ? "Personal exp." : "Standard"}
                </span>
                <span>{item.content_type}</span>
                {item.pixel_required && (
                  <span className="text-[var(--brand-blue)]">Pixel</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="mt-4 pt-4 border-t border-[var(--brand-border)]">
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1">
                Total Downloads
              </div>
              <div className="text-lg font-bold text-[var(--brand-text)]">
                {totalDownloads.toLocaleString()}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1">
                Total Gross
              </div>
              <div className="text-lg font-bold text-[var(--brand-text)]">
                $
                {totalGross.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1">
                Total Net
              </div>
              <div className="text-lg font-bold text-[var(--brand-blue)]">
                $
                {totalNet.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Terms */}
      <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-4">
          Terms &amp; Conditions
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Payment Terms</label>
            <div className={valueClass}>{io.payment_terms || "Net 30 EOM"}</div>
          </div>
          <div>
            <label className={labelClass}>Exclusivity (days)</label>
            <div className={valueClass}>{io.exclusivity_days ?? 90}</div>
          </div>
          <div>
            <label className={labelClass}>ROFR (days)</label>
            <div className={valueClass}>{io.rofr_days ?? 30}</div>
          </div>
          <div>
            <label className={labelClass}>Cancellation Notice (days)</label>
            <div className={valueClass}>{io.cancellation_notice_days ?? 14}</div>
          </div>
          <div>
            <label className={labelClass}>Download Tracking (days)</label>
            <div className={valueClass}>{io.download_tracking_days ?? 45}</div>
          </div>
          <div>
            <label className={labelClass}>Make-Good Threshold</label>
            <div className={valueClass}>
              {((io.make_good_threshold ?? 0.1) * 100).toFixed(0)}%
            </div>
          </div>
        </div>
        {io.competitor_exclusion && io.competitor_exclusion.length > 0 && (
          <div className="mt-4">
            <label className={labelClass}>Competitor Exclusion</label>
            <div className="flex items-center gap-2 flex-wrap">
              {io.competitor_exclusion.map((comp) => (
                <span
                  key={comp}
                  className="text-xs bg-[var(--brand-orange)]/[0.08] text-[var(--brand-orange)] px-2.5 py-1 rounded-full font-medium"
                >
                  {comp}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={onEdit}
          className="px-5 py-2.5 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors"
        >
          Edit
        </button>
        <button
          onClick={onConfirm}
          disabled={isConfirming}
          className="px-5 py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {isConfirming ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Importing...
            </span>
          ) : (
            "Confirm Import"
          )}
        </button>
      </div>
    </div>
  );
}
