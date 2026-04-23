// Magic link email — sent to a show that wants to respond to an outreach
// but hasn't created an account yet. The link drops them into Wave 9 onboarding;
// after onboarding completes, the return_url stored in the token sends them
// back to the original pitch page to accept/counter/decline.

export interface MagicLinkEmailInput {
  to_email: string;
  brand_name: string;
  show_name: string;
  magic_link_url: string;
}

export interface RenderedMagicLinkEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderMagicLinkEmail(
  input: MagicLinkEmailInput
): RenderedMagicLinkEmail {
  const subject = `Set up your Taylslate account to respond to ${input.brand_name}`;

  const html = `
<!DOCTYPE html>
<html>
  <body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:520px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px 28px;">
        <h1 style="font-size:18px;font-weight:600;color:#111827;margin:0 0 12px;">Welcome to Taylslate</h1>
        <p style="font-size:14px;color:#1f2937;line-height:1.6;margin:0 0 14px;">
          ${escapeHtml(input.brand_name)} reached out about a sponsorship for ${escapeHtml(input.show_name)}.
          Set up a quick profile to respond — it takes about three minutes.
        </p>
        <a href="${escapeHtml(input.magic_link_url)}"
           style="display:inline-block;margin-top:6px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 20px;border-radius:8px;">
          Set up my account
        </a>
        <p style="font-size:12px;color:#6b7280;margin-top:18px;line-height:1.55;">
          This link expires in 24 hours. After your profile is ready, we'll bring you straight back to the pitch.
        </p>
      </div>
      <div style="font-size:11px;color:#9ca3af;text-align:center;margin-top:16px;">
        Taylslate — the transaction layer for podcast sponsorship.
      </div>
    </div>
  </body>
</html>`.trim();

  const text = [
    `Welcome to Taylslate`,
    ``,
    `${input.brand_name} reached out about a sponsorship for ${input.show_name}. Set up a quick profile to respond:`,
    ``,
    input.magic_link_url,
    ``,
    `This link expires in 24 hours. After your profile is ready, we'll bring you straight back to the pitch.`,
  ].join("\n");

  return { subject, html, text };
}
