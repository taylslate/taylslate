// Login magic-link email — sent when a brand or show asks for a sign-in link
// from /login. One subject, one sentence, one button. Not a URL-only message.
// Outreach show-onboarding mail (magic-link.ts) is a different template; leave it.

export interface LoginMagicEmailInput {
  login_url: string;
}

export interface RenderedLoginMagicEmail {
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

export function renderLoginMagicEmail(
  input: LoginMagicEmailInput,
): RenderedLoginMagicEmail {
  const subject = "Log in to Taylslate";
  const sentence = "Click the button to sign in. This link expires in 24 hours.";
  const href = escapeHtml(input.login_url);

  const html = `
<!DOCTYPE html>
<html>
  <body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:520px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px 28px;">
        <p style="font-size:14px;color:#1f2937;line-height:1.6;margin:0 0 14px;">
          ${sentence}
        </p>
        <a href="${href}"
           style="display:inline-block;margin-top:6px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 20px;border-radius:8px;">
          Log in
        </a>
      </div>
    </div>
  </body>
</html>`.trim();

  const text = [sentence, "", input.login_url].join("\n");

  return { subject, html, text };
}
