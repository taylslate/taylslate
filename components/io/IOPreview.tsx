"use client";

import type { InsertionOrder } from "@/lib/data";
import { formatDateOnly } from "@/lib/format/date-only";
import { tokens } from "@/lib/brand/tokens";

interface IOPreviewProps {
  io: Partial<InsertionOrder>;
  onEdit: () => void;
  onConfirm: () => void;
  isConfirming?: boolean;
}

const radiusStyle = { borderRadius: tokens.radius };

const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const panelClass =
  "mb-6 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-5";
const sectionHead =
  "mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--ts-ink-on-paper)]";
const labelClass = "mb-1.5 block text-sm font-medium text-[var(--ts-ink-on-paper)]";
const valueClass =
  "w-full break-words border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-shows)] px-3 py-2 text-sm text-[var(--ts-ink-muted-on-paper)]";
const inkBtnClass =
  "inline-flex items-center justify-center gap-2 bg-[var(--ts-ink-on-paper)] px-5 py-2.5 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtnClass =
  "inline-flex items-center justify-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-5 py-2.5 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)]";

function money(amount: number): string {
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function IOPreview({ io, onEdit, onConfirm, isConfirming }: IOPreviewProps) {
  const lineItems = io.line_items ?? [];
  const totalDownloads = io.total_downloads ?? 0;
  const totalGross = io.total_gross ?? 0;
  const totalNet = io.total_net ?? 0;

  return (
    <div>
      <div className={panelClass} style={radiusStyle}>
        <div className="flex items-center justify-between">
          <div>
            <span className={`text-xs font-medium uppercase tracking-wider ${mutedText}`}>
              IO Number
            </span>
            <div className={`mt-0.5 text-lg font-semibold ${inkText}`}>
              {io.io_number ?? "—"}
            </div>
          </div>
          <span
            className="bg-[var(--ts-band-shows)] px-2.5 py-1 text-xs font-medium text-[var(--ts-ink-on-paper)]"
            style={radiusStyle}
          >
            Import Preview
          </span>
        </div>
      </div>

      <section className={panelClass} style={radiusStyle}>
        <h2 className={sectionHead}>Advertiser</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Company</label>
            <div className={valueClass} style={radiusStyle}>{io.advertiser_name || "—"}</div>
          </div>
          <div>
            <label className={labelClass}>Contact</label>
            <div className={valueClass} style={radiusStyle}>{io.advertiser_contact_name || "—"}</div>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Email</label>
            <div className={valueClass} style={radiusStyle}>{io.advertiser_contact_email || "—"}</div>
          </div>
        </div>
      </section>

      <section className={panelClass} style={radiusStyle}>
        <h2 className={sectionHead}>Publisher</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Company</label>
            <div className={valueClass} style={radiusStyle}>{io.publisher_name || "—"}</div>
          </div>
          <div>
            <label className={labelClass}>Contact</label>
            <div className={valueClass} style={radiusStyle}>{io.publisher_contact_name || "—"}</div>
          </div>
          <div>
            <label className={labelClass}>Email</label>
            <div className={valueClass} style={radiusStyle}>{io.publisher_contact_email || "—"}</div>
          </div>
          {io.publisher_address && (
            <div>
              <label className={labelClass}>Address</label>
              <div className={valueClass} style={radiusStyle}>{io.publisher_address}</div>
            </div>
          )}
        </div>
      </section>

      {io.agency_name && (
        <section className={panelClass} style={radiusStyle}>
          <h2 className={sectionHead}>Agency</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Company</label>
              <div className={valueClass} style={radiusStyle}>{io.agency_name}</div>
            </div>
            <div>
              <label className={labelClass}>Contact</label>
              <div className={valueClass} style={radiusStyle}>{io.agency_contact_name || "—"}</div>
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <div className={valueClass} style={radiusStyle}>{io.agency_contact_email || "—"}</div>
            </div>
            {io.send_invoices_to && (
              <div>
                <label className={labelClass}>Send Invoices To</label>
                <div className={valueClass} style={radiusStyle}>{io.send_invoices_to}</div>
              </div>
            )}
          </div>
        </section>
      )}

      <section className={panelClass} style={radiusStyle}>
        <h2 className={sectionHead}>Line Items</h2>
        <div className="space-y-3">
          {lineItems.map((item, index) => (
            <div
              key={item.id}
              className="border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-shows)] p-4"
              style={radiusStyle}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex h-6 w-6 items-center justify-center bg-[var(--ts-band-brands)] text-xs font-medium text-[var(--ts-ink-on-paper)]"
                  style={radiusStyle}
                >
                  {index + 1}
                </span>
                <span className={`text-sm font-medium ${inkText}`}>
                  {item.show_name || "Untitled Show"}
                </span>
                <span
                  className={`px-2 py-0.5 text-xs ${mutedText}`}
                  style={radiusStyle}
                >
                  {item.placement} &middot; {item.reader_type.replace("_", " ")}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className={labelClass}>Post Date</label>
                  <div className={valueClass} style={radiusStyle}>{formatDateOnly(item.post_date)}</div>
                </div>
                <div>
                  <label className={labelClass}>Guaranteed DLs</label>
                  <div className={valueClass} style={radiusStyle}>
                    {item.guaranteed_downloads.toLocaleString()}
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Gross Rate</label>
                  <div className={valueClass} style={radiusStyle}>
                    ${money(item.gross_rate)}
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Net Due</label>
                  <div
                    className="w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-brands)] px-3 py-2 text-sm font-semibold text-[var(--ts-ink-on-paper)]"
                    style={radiusStyle}
                  >
                    ${money(item.net_due)}
                  </div>
                </div>
              </div>
              <div className={`mt-3 flex flex-wrap items-center gap-4 text-xs ${mutedText}`}>
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
                  <span className={inkText}>Pixel</span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 border-t border-[var(--ts-hairline-on-paper)] pt-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="text-center">
              <div className={`mb-1 text-xs font-medium uppercase tracking-wider ${mutedText}`}>
                Total Downloads
              </div>
              <div className={`text-lg font-semibold ${inkText}`}>
                {totalDownloads.toLocaleString()}
              </div>
            </div>
            <div className="text-center">
              <div className={`mb-1 text-xs font-medium uppercase tracking-wider ${mutedText}`}>
                Total Gross
              </div>
              <div className={`text-lg font-semibold ${inkText}`}>
                ${money(totalGross)}
              </div>
            </div>
            <div className="text-center">
              <div className={`mb-1 text-xs font-medium uppercase tracking-wider ${mutedText}`}>
                Total Net
              </div>
              <div className={`text-lg font-semibold ${inkText}`}>
                ${money(totalNet)}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={panelClass} style={radiusStyle}>
        <h2 className={sectionHead}>Terms &amp; Conditions</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Payment Terms</label>
            <div className={valueClass} style={radiusStyle}>{io.payment_terms || "Net 30 EOM"}</div>
          </div>
          <div>
            <label className={labelClass}>Exclusivity (days)</label>
            <div className={valueClass} style={radiusStyle}>{io.exclusivity_days ?? 90}</div>
          </div>
          <div>
            <label className={labelClass}>ROFR (days)</label>
            <div className={valueClass} style={radiusStyle}>{io.rofr_days ?? 30}</div>
          </div>
          <div>
            <label className={labelClass}>Cancellation Notice (days)</label>
            <div className={valueClass} style={radiusStyle}>{io.cancellation_notice_days ?? 14}</div>
          </div>
          <div>
            <label className={labelClass}>Download Tracking (days)</label>
            <div className={valueClass} style={radiusStyle}>{io.download_tracking_days ?? 45}</div>
          </div>
          <div>
            <label className={labelClass}>Make-Good Threshold</label>
            <div className={valueClass} style={radiusStyle}>
              {((io.make_good_threshold ?? 0.1) * 100).toFixed(0)}%
            </div>
          </div>
        </div>
        {io.competitor_exclusion && io.competitor_exclusion.length > 0 && (
          <div className="mt-4">
            <label className={labelClass}>Competitor Exclusion</label>
            <div className="flex flex-wrap items-center gap-2">
              {io.competitor_exclusion.map((comp) => (
                <span
                  key={comp}
                  className="bg-[var(--ts-band-shows)] px-2.5 py-1 text-xs font-medium text-[var(--ts-ink-on-paper)]"
                  style={radiusStyle}
                >
                  {comp}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onEdit} className={ghostBtnClass} style={radiusStyle}>
          Edit
        </button>
        <button
          onClick={onConfirm}
          disabled={isConfirming}
          className={inkBtnClass}
          style={radiusStyle}
        >
          {isConfirming ? "Importing..." : "Confirm Import"}
        </button>
      </div>
    </div>
  );
}
