/**
 * Remove HTML tags and decode common named entities from a string.
 * Used for rendering third-party feed content (Podscan show descriptions
 * often come through with raw <p>, <a>, and <br> tags).
 *
 * Intentionally minimal — we don't need a full HTML parser; we just want
 * plain text for display in a <textarea> or text node.
 */
export function stripHtml(input: string | null | undefined): string {
  if (!input) return "";
  return input
    // Drop script/style blocks entirely (content and tags)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    // <br> and <p> become whitespace so adjacent words don't fuse
    .replace(/<\/?(?:br|p|div|li)\b[^>]*>/gi, "\n")
    // Strip all remaining tags
    .replace(/<[^>]*>/g, "")
    // Decode the handful of entities we actually see in feed data
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Collapse runs of whitespace into single spaces, trim the result
    .replace(/\s+/g, " ")
    .trim();
}
