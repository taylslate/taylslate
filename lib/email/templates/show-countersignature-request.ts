// Sent to the show after the brand signs but before DocuSign emails the show.
// Heads-up email — DocuSign will follow with its own ceremonial signing email.

export interface ShowCountersignInput {
  brand_name: string;
  show_name: string;
  agreed_cpm: number;
  agreed_episode_count: number;
}

export interface RenderedShowCountersign {
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

export function renderShowCountersignatureRequest(
  input: ShowCountersignInput
): RenderedShowCountersign {
  const subject = `${input.brand_name} signed — your IO is on the way`;
  const html = `
<!DOCTYPE html>
<html>
  <body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px 28px;">
        <h1 style="font-size:18px;font-weight:600;color:#111827;margin:0 0 12px;">
          ${escapeHtml(input.brand_name)} signed your IO
        </h1>
        <p style="font-size:14px;color:#1f2937;line-height:1.6;margin:0 0 14px;">
          DocuSign is sending the IO directly to you in a separate email — look out for it
          in the next few minutes. Once you sign, the deal is locked and we'll send a
          confirmation with delivery dates.
        </p>
        <p style="font-size:13px;color:#374151;background:#f3f4f6;border-radius:8px;padding:12px 14px;line-height:1.55;">
          Agreed terms: <strong>$${input.agreed_cpm.toFixed(2)} CPM</strong>
          × <strong>${input.agreed_episode_count}</strong> episode${input.agreed_episode_count === 1 ? "" : "s"}.
        </p>
        <p style="font-size:12px;color:#6b7280;margin-top:14px;">
          The DocuSign email will come from dse@docusign.net — that's normal.
        </p>
      </div>
    </div>
  </body>
</html>`.trim();
  const text = [
    `${input.brand_name} signed the IO. DocuSign is sending it to you for countersignature in a separate email.`,
    "",
    `Agreed terms: $${input.agreed_cpm.toFixed(2)} CPM × ${input.agreed_episode_count} episodes.`,
    "",
    `The DocuSign email will come from dse@docusign.net — that's normal.`,
  ].join("\n");
  return { subject, html, text };
}
