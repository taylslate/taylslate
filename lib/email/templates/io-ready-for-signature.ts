// Sent to the brand when a show accepts an outreach (or when the brand
// accepts a counter). Tells them an IO is ready for review and signature.

export interface IoReadyInput {
  brand_name: string;
  show_name: string;
  agreed_cpm: number;
  agreed_episode_count: number;
  deal_url: string;
}

export interface RenderedIoReady {
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

export function renderIoReadyForSignature(
  input: IoReadyInput
): RenderedIoReady {
  const subject = `${input.show_name} accepted — review the IO to lock the deal`;
  const html = `
<!DOCTYPE html>
<html>
  <body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px 28px;">
        <h1 style="font-size:18px;font-weight:600;color:#111827;margin:0 0 12px;">
          ${escapeHtml(input.show_name)} accepted your offer
        </h1>
        <p style="font-size:14px;color:#1f2937;line-height:1.6;margin:0 0 14px;">
          ${escapeHtml(input.show_name)} agreed to your terms — $${input.agreed_cpm.toFixed(2)} CPM
          across ${input.agreed_episode_count} episode${input.agreed_episode_count === 1 ? "" : "s"}.
          Your IO is ready. Review it, then sign to send to the show for countersignature.
        </p>
        <a href="${escapeHtml(input.deal_url)}"
           style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 20px;border-radius:8px;">
          Review and sign IO
        </a>
        <p style="font-size:12px;color:#6b7280;margin-top:18px;">
          You'll be redirected to DocuSign to sign. After you sign, we send it to ${escapeHtml(input.show_name)} to countersign.
        </p>
      </div>
    </div>
  </body>
</html>`.trim();

  const text = [
    `${input.show_name} accepted your offer.`,
    "",
    `Agreed terms: $${input.agreed_cpm.toFixed(2)} CPM × ${input.agreed_episode_count} episodes.`,
    "",
    `Review and sign the IO: ${input.deal_url}`,
  ].join("\n");

  return { subject, html, text };
}
