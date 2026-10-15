// Sender addresses for every Taylslate email.
// The domain is verified in Resend; the local-part tells the recipient
// what kind of message it is. Display names stay short — never a paragraph.

export const EMAIL_FROM_AUTH = "Taylslate <auth@taylslate.com>";
export const EMAIL_FROM_NOTIFICATIONS = "Taylslate <notifications@taylslate.com>";
export const EMAIL_FROM_OUTREACH = "Taylslate <outreach@taylslate.com>";

export const EMAIL_ADDRESS_OUTREACH = "outreach@taylslate.com";
export const EMAIL_ADDRESS_INVOICES = "invoices@taylslate.com";
export const EMAIL_ADDRESS_IO = "io@taylslate.com";

/** Strip characters that break a From header. Does not cap length. */
export function sanitizeDisplayName(raw: string): string {
  return raw
    .replace(/[<>"\\]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "{Name} via Taylslate <mailbox>". Empty names fall back to Taylslate. */
export function viaTaylslateFrom(displayName: string, mailbox: string): string {
  const safe = sanitizeDisplayName(displayName);
  const name = safe ? `${safe} via Taylslate` : "Taylslate";
  return `${name} <${mailbox}>`;
}
