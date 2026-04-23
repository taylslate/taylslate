// Sent by the daily cron when a deal has been in 'planning' for 3+ days
// without the brand sending it to DocuSign. One-shot — `brand_reminder_sent_at`
// gets stamped after this fires.

export interface BrandReminderInput {
  brand_name: string;
  show_name: string;
  agreed_cpm: number;
  agreed_episode_count: number;
  deal_url: string;
  days_waiting: number;
}

export interface RenderedBrandReminder {
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

export function renderBrandSignatureReminder(
  input: BrandReminderInput
): RenderedBrandReminder {
  const subject = `Reminder: your IO for ${input.show_name} is waiting for your signature`;
  const html = `
<!DOCTYPE html>
<html>
  <body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px 28px;">
        <h1 style="font-size:18px;font-weight:600;color:#111827;margin:0 0 12px;">
          Quick nudge — your IO is sitting unsigned
        </h1>
        <p style="font-size:14px;color:#1f2937;line-height:1.6;margin:0 0 14px;">
          ${escapeHtml(input.show_name)} accepted your offer ${input.days_waiting} days ago. The
          IO ($${input.agreed_cpm.toFixed(2)} CPM × ${input.agreed_episode_count} episodes) is
          ready and waiting for your signature so we can send it to the show.
        </p>
        <a href="${escapeHtml(input.deal_url)}"
           style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 20px;border-radius:8px;">
          Sign the IO now
        </a>
        <p style="font-size:12px;color:#6b7280;margin-top:18px;line-height:1.55;">
          Heads up — deals auto-cancel after 14 days of inactivity to keep show inventory fresh.
        </p>
      </div>
    </div>
  </body>
</html>`.trim();
  const text = [
    `${input.show_name} accepted your offer ${input.days_waiting} days ago.`,
    `The IO is waiting for your signature.`,
    "",
    `Sign now: ${input.deal_url}`,
    "",
    `Deals auto-cancel after 14 days of inactivity.`,
  ].join("\n");
  return { subject, html, text };
}
