// Brand-forward outreach pitch email.
// Tone reference: VeritoneOne IO PDF — boringly professional, no marketing fluff.
// The brand name is the from-name; the Taylslate footer is small and contextual.

import type { Outreach } from "@/lib/data/types";

export interface OutreachEmailInput {
  /** Recipient — the show. */
  show_name: string;
  to_email: string;

  /** Sender — the brand. */
  brand_name: string;
  brand_url?: string | null;

  /** The Claude-generated, brand-edited pitch body (plain text). */
  pitch_body: string;

  /** Proposed terms, displayed verbatim in the body. */
  proposed_cpm: number;
  proposed_episode_count: number;
  proposed_placement: Outreach["proposed_placement"];
  proposed_flight_start: string;
  proposed_flight_end: string;

  /** Public pitch URL the show clicks to respond. */
  pitch_url: string;
}

export interface RenderedOutreachEmail {
  subject: string;
  html: string;
  text: string;
  from: string;
  reply_to: string;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pitchBodyAsHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="font-size:14px;color:#1f2937;line-height:1.65;margin:0 0 14px;">${escapeHtml(
          p
        ).replace(/\n/g, "<br/>")}</p>`
    )
    .join("");
}

function placementLabel(p: string): string {
  return p === "pre-roll"
    ? "Pre-roll"
    : p === "mid-roll"
      ? "Mid-roll"
      : "Post-roll";
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// A from-name must be a name, never a paragraph. The upstream resolver can in
// principle still hand us a long free-text value (legacy data, a future caller);
// this collapses any input to something that can only render as a name across
// the subject, From line, and footer. Structural backstop, not the primary fix.
const MAX_BRAND_NAME_LENGTH = 60;

function normalizeBrandName(raw: string | null | undefined): string {
  const firstLine = (raw ?? "").split(/\r?\n/)[0] ?? "";
  const cleaned = firstLine
    // Strip header-injection chars; replace control chars with spaces.
    .replace(/[<>"\\]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "Sponsorship";
  if (cleaned.length <= MAX_BRAND_NAME_LENGTH) return cleaned;

  // Over the cap: cut at the last word boundary within the cap so we never emit
  // a mid-word fragment; hard-cut if the first word alone exceeds the cap.
  const capped = cleaned.slice(0, MAX_BRAND_NAME_LENGTH);
  const lastSpace = capped.lastIndexOf(" ");
  const truncated = (lastSpace > 0 ? capped.slice(0, lastSpace) : capped).trim();
  return truncated || "Sponsorship";
}

/**
 * Brands send under their own from-name with reply-to set to a Taylslate-tracked
 * address (so we capture replies into the conversation thread later). The send
 * domain stays @taylslate.com to satisfy SPF/DKIM until brand-domain sending
 * lands in a later wave. Expects an already-normalized name; the char-strip
 * stays as belt-and-suspenders.
 */
function buildFromAndReply(brandName: string): { from: string; reply_to: string } {
  const safeName = brandName.replace(/[<>"\\]/g, "").trim() || "Sponsorship";
  return {
    from: `${safeName} <outreach@taylslate.com>`,
    reply_to: "outreach@taylslate.com",
  };
}

export function renderOutreachEmail(input: OutreachEmailInput): RenderedOutreachEmail {
  // Normalize once so the brand name can only ever render as a name across the
  // subject, From line, and footer — never a paragraph.
  const brandName = normalizeBrandName(input.brand_name);
  const subject = `${brandName} x ${input.show_name} — quick intro`;
  const { from, reply_to } = buildFromAndReply(brandName);

  const termsRowsHtml = [
    ["Proposed CPM", `$${input.proposed_cpm.toFixed(2)}`],
    [
      "Episodes",
      `${input.proposed_episode_count} ${input.proposed_episode_count === 1 ? "episode" : "episodes"}`,
    ],
    ["Placement", placementLabel(input.proposed_placement)],
    [
      "Flight",
      `${fmtDate(input.proposed_flight_start)} – ${fmtDate(input.proposed_flight_end)}`,
    ],
  ]
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#6b7280;width:140px;">${escapeHtml(label)}</td>
          <td style="padding:6px 0;font-size:13px;color:#111827;font-weight:500;">${escapeHtml(value)}</td>
        </tr>`
    )
    .join("");

  const html = `
<!DOCTYPE html>
<html>
  <body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="padding:24px 28px 8px;">
          <div style="font-size:12px;color:#6b7280;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:4px;">From</div>
          <div style="font-size:16px;font-weight:600;color:#111827;">${escapeHtml(brandName)}</div>
          ${
            input.brand_url
              ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${escapeHtml(input.brand_url)}</div>`
              : ""
          }
        </div>
        <div style="padding:8px 28px 24px;">
          ${pitchBodyAsHtml(input.pitch_body)}

          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin:18px 0;background:#f9fafb;">
            <div style="font-size:11px;color:#6b7280;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:8px;">Proposed terms</div>
            <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
              ${termsRowsHtml}
            </table>
          </div>

          <div style="margin:24px 0 8px;">
            <a href="${escapeHtml(input.pitch_url)}"
               style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;">
              See the full pitch and respond
            </a>
          </div>
          <div style="font-size:12px;color:#6b7280;margin-top:6px;">
            Or reply directly to this email if you'd rather chat first.
          </div>
        </div>
      </div>

      <div style="font-size:11px;color:#9ca3af;text-align:center;margin-top:20px;line-height:1.5;">
        Payments and contracting powered by Taylslate.<br/>
        You're receiving this because ${escapeHtml(brandName)} reached out about a sponsorship opportunity for ${escapeHtml(input.show_name)}.
      </div>
    </div>
  </body>
</html>`.trim();

  const textTerms = [
    `Proposed CPM: $${input.proposed_cpm.toFixed(2)}`,
    `Episodes: ${input.proposed_episode_count}`,
    `Placement: ${placementLabel(input.proposed_placement)}`,
    `Flight: ${fmtDate(input.proposed_flight_start)} – ${fmtDate(input.proposed_flight_end)}`,
  ].join("\n");

  const text = [
    input.pitch_body.trim(),
    "",
    "Proposed terms",
    "--------------",
    textTerms,
    "",
    `See the full pitch and respond: ${input.pitch_url}`,
    "",
    "Or reply directly to this email if you'd rather chat first.",
    "",
    "—",
    "Payments and contracting powered by Taylslate.",
  ].join("\n");

  return { subject, html, text, from, reply_to };
}
