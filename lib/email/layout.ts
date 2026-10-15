// Shared layout for every Taylslate email.
//
// Email clients ignore CSS variables, so these hex values are the paper/ink
// tokens from lib/brand/tokens.css:
//   --ts-paper                 #f2ebe1
//   --ts-ink-on-paper          #1c1915
//   --ts-ink-muted-on-paper    #5c564c
//   --ts-accent                #c17a45  (links only)
//   --ts-radius                4px
// The hairline is ink at 12% over paper, flattened to a solid hex.
// Primary buttons are ink fill with paper text, matching the site.

export const emailColors = {
  paper: "#f2ebe1",
  ink: "#1c1915",
  muted: "#5c564c",
  accent: "#c17a45",
  hairline: "#d8d2c8",
  buttonText: "#f2ebe1",
} as const;

export const EMAIL_WORDMARK = "taylslate";
export const EMAIL_SITE_URL = "https://www.taylslate.com";
export const EMAIL_MARK_URL = `${EMAIL_SITE_URL}/mark.png`;
export const EMAIL_FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

const PRODUCT_LINE = "Podcast and YouTube sponsorships";

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmailLayoutInput {
  /** Inbox preview line. Also the document title. */
  preheader: string;
  headline?: string;
  /** Trusted HTML. Callers escape any interpolated text. */
  bodyHtml: string;
  cta?: { href: string; label: string };
  /** Plain sentence under the button. */
  note?: string;
  /** Plain-text body. The layout appends the standard footer. */
  text: string;
}

export function renderEmailLayout(input: EmailLayoutInput): {
  html: string;
  text: string;
} {
  const preheader = escapeHtml(input.preheader);
  const year = new Date().getFullYear();
  const headline = input.headline
    ? `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:600;color:${emailColors.ink};">${escapeHtml(input.headline)}</h1>`
    : "";
  const cta = input.cta
    ? `<p style="margin:20px 0 0;"><a href="${escapeHtml(input.cta.href)}" style="display:inline-block;background:${emailColors.ink};color:${emailColors.buttonText};text-decoration:none;font-weight:600;font-size:14px;line-height:1;padding:12px 18px;border-radius:4px;">${escapeHtml(input.cta.label)}</a></p>`
    : "";
  const note = input.note
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:${emailColors.muted};">${escapeHtml(input.note)}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${preheader}</title>
</head>
<body style="margin:0;padding:0;background:${emailColors.paper};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>
<table role="presentation" data-taylslate-email="1" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${emailColors.paper};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
<tr><td style="padding:0 0 20px;font-family:${EMAIL_FONT};">
<img src="${EMAIL_MARK_URL}" width="28" height="28" alt="" style="vertical-align:middle;border:0;display:inline-block;">
<span style="font-size:15px;font-weight:600;letter-spacing:-0.01em;color:${emailColors.ink};vertical-align:middle;padding-left:8px;">${EMAIL_WORDMARK}</span>
</td></tr>
<tr><td style="border-top:1px solid ${emailColors.hairline};padding:24px 0 8px;font-family:${EMAIL_FONT};color:${emailColors.ink};font-size:14px;line-height:1.6;">
${headline}${input.bodyHtml}${cta}${note}
</td></tr>
<tr><td style="border-top:1px solid ${emailColors.hairline};padding:16px 0 0;font-family:${EMAIL_FONT};font-size:12px;line-height:1.5;color:${emailColors.muted};">
© ${year} Taylslate<br>
${PRODUCT_LINE}<br>
<a href="${EMAIL_SITE_URL}" style="color:${emailColors.accent};text-decoration:none;">taylslate.com</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    input.text.trim(),
    "",
    "—",
    `Taylslate`,
    PRODUCT_LINE,
    EMAIL_SITE_URL,
    `© ${year} Taylslate`,
  ].join("\n");

  return { html, text };
}

export function emailParagraph(html: string): string {
  return `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${emailColors.ink};">${html}</p>`;
}

export function emailDetailTable(rows: Array<[string, string]>): string {
  const body = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 16px 6px 0;font-size:13px;color:${emailColors.muted};vertical-align:top;">${label}</td><td style="padding:6px 0;font-size:13px;color:${emailColors.ink};font-weight:600;vertical-align:top;">${value}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:4px 0 12px;">${body}</table>`;
}

export function emailDataTable(headers: string[], rows: string[][]): string {
  const head = headers
    .map(
      (header, index) =>
        `<th style="padding:8px 10px;font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${emailColors.buttonText};text-align:${index === headers.length - 1 ? "right" : "left"};background:${emailColors.ink};">${header}</th>`,
    )
    .join("");
  const body = rows
    .map((row) => {
      const cells = row
        .map(
          (cell, index) =>
            `<td style="padding:8px 10px;font-size:13px;color:${emailColors.ink};border-bottom:1px solid ${emailColors.hairline};text-align:${index === row.length - 1 ? "right" : "left"};">${cell}</td>`,
        )
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:8px 0 16px;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function plainParagraphs(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => emailParagraph(escapeHtml(paragraph).replace(/\r?\n/g, "<br>")))
    .join("");
}
