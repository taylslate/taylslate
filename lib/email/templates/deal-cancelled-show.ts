// Sent to the show when a deal is cancelled — by the brand or by 14-day timeout.

export interface DealCancelledInput {
  brand_name: string;
  show_name: string;
  reason?: string | null;
  /** "timeout" gets a different friendlier framing than brand-initiated cancels. */
  cause: "brand_cancelled" | "timeout";
}

export interface RenderedDealCancelled {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderDealCancelledShow(
  input: DealCancelledInput
): RenderedDealCancelled {
  const subject =
    input.cause === "timeout"
      ? `This opportunity has closed`
      : `${input.brand_name} cancelled the deal`;

  const headline =
    input.cause === "timeout"
      ? `The ${escapeHtml(input.brand_name)} opportunity has closed`
      : `${escapeHtml(input.brand_name)} cancelled the deal`;

  const body =
    input.cause === "timeout"
      ? `It's been more than two weeks without a signed IO, so we've closed this one out to keep your inventory available for other brands. ${escapeHtml(input.brand_name)} can still reach out again later.`
      : `${escapeHtml(input.brand_name)} cancelled before sending the IO for signature.${
          input.reason ? ` Reason: <em>${escapeHtml(input.reason)}</em>` : ""
        }`;

  const html = `
<!DOCTYPE html>
<html>
  <body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:520px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px 28px;">
        <h1 style="font-size:18px;font-weight:600;color:#111827;margin:0 0 12px;">${headline}</h1>
        <p style="font-size:14px;color:#1f2937;line-height:1.6;margin:0 0 12px;">${body}</p>
        <p style="font-size:13px;color:#374151;line-height:1.55;">
          Nothing you need to do — your show stays open for new brands. We'll be in touch when the next one comes through.
        </p>
      </div>
      <div style="font-size:11px;color:#9ca3af;text-align:center;margin-top:16px;">Taylslate</div>
    </div>
  </body>
</html>`.trim();
  const text = [
    headline,
    "",
    input.cause === "timeout"
      ? `It's been more than two weeks without a signed IO, so we've closed this one out.`
      : `${input.brand_name} cancelled before sending the IO for signature.${input.reason ? ` Reason: ${input.reason}` : ""}`,
    "",
    `Your show stays open for new brands.`,
  ].join("\n");
  return { subject, html, text };
}
