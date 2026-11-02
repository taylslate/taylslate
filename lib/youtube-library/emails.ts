// Contact emails from text YouTube's Data API already returned.
// Channel descriptions, About URLs inside that text, and recent video
// descriptions. No HTML page fetch, no redirect follow, no captcha.

export type EmailSource = "channel_description" | "about_link" | "video_description";

export interface FoundEmail {
  email: string;
  source: EmailSource;
}

const EMAIL_BODY =
  "[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+";
const EMAIL_PATTERN = new RegExp(EMAIL_BODY, "gi");
const EMAIL_EXACT = new RegExp(`^${EMAIL_BODY}$`, "i");

const URL_PATTERN = /\b(?:mailto:|https?:\/\/)[^\s<>"'`]+/gi;

const JUNK_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "email.com",
  "domain.com",
  "yoursite.com",
  "website.com",
  "yourdomain.com",
  "company.com",
  "test.com",
  "localhost",
  "youtube.com",
  "youtu.be",
  "google.com",
  "gstatic.com",
  "schema.org",
  "w3.org",
  "sentry.io",
  "wixpress.com",
]);

const JUNK_LOCAL = new Set([
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "example",
  "test",
  "username",
  "yourname",
  "name",
  "email",
  "user",
  "someone",
  "you",
  "abc",
  "xxx",
  "your",
  "firstname",
  "lastname",
]);

const EMAIL_PARAMS = new Set(["email", "e-mail", "mail", "contact", "to"]);

function deobfuscate(text: string): string {
  return text.replace(
    /([a-z0-9._%+-]{1,64})\s*(?:\[at\]|\(at\)|\bat\b)\s*([a-z0-9.-]{1,253})\s*(?:\[dot\]|\(dot\)|\bdot\b)\s*([a-z]{2,24})/gi,
    "$1@$2.$3"
  );
}

export function normalizeContactEmail(raw: string): string | null {
  let email = raw.trim().toLowerCase();
  if (email.startsWith("mailto:")) email = email.slice("mailto:".length);
  email = email.split("?")[0] ?? "";
  email = email.replace(/^<+/, "").replace(/[)>.,;:\]"']+$/g, "");
  if (!email || email.length < 6 || email.length > 320) return null;
  if (!EMAIL_EXACT.test(email)) return null;
  const at = email.indexOf("@");
  if (at <= 0 || email.indexOf("@", at + 1) !== -1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || !domain || domain.startsWith(".") || domain.endsWith(".")) return null;
  if (local.includes("..") || domain.includes("..")) return null;
  if (JUNK_LOCAL.has(local)) return null;
  if (JUNK_DOMAINS.has(domain)) return null;
  if (domain.endsWith(".png") || domain.endsWith(".jpg") || domain.endsWith(".jpeg")) return null;
  if (domain.endsWith(".gif") || domain.endsWith(".webp") || domain.endsWith(".svg")) return null;
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (!/^[a-z]{2,24}$/.test(tld)) return null;
  return email;
}

function pushEmail(out: FoundEmail[], seen: Set<string>, raw: string, source: EmailSource): void {
  const email = normalizeContactEmail(raw);
  if (!email) return;
  const key = `${source}\0${email}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ email, source });
}

function emailsInText(text: string, source: EmailSource, out: FoundEmail[], seen: Set<string>): void {
  const prepared = deobfuscate(text);
  EMAIL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EMAIL_PATTERN.exec(prepared)) !== null) {
    pushEmail(out, seen, match[0], source);
  }
}

function trimUrl(raw: string): string {
  return raw.replace(/[)>.,;:\]"']+$/g, "");
}

function emailsInUrl(rawUrl: string, out: FoundEmail[], seen: Set<string>, depth: number): void {
  const cleaned = trimUrl(rawUrl);
  if (!cleaned || depth > 2) return;
  if (cleaned.toLowerCase().startsWith("mailto:")) {
    pushEmail(out, seen, cleaned, "about_link");
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    emailsInText(cleaned, "about_link", out, seen);
    return;
  }
  const host = parsed.hostname.toLowerCase();
  const redirect = (host === "youtube.com" || host.endsWith(".youtube.com")) && parsed.pathname.includes("/redirect");
  if (redirect) {
    const target = parsed.searchParams.get("q") ?? parsed.searchParams.get("url") ?? "";
    if (target) {
      let decoded = target;
      try {
        decoded = decodeURIComponent(target);
      } catch {
        decoded = target;
      }
      emailsInUrl(decoded, out, seen, depth + 1);
    }
  }
  for (const [key, value] of parsed.searchParams.entries()) {
    if (!EMAIL_PARAMS.has(key.toLowerCase())) continue;
    pushEmail(out, seen, value, "about_link");
  }
  emailsInText(`${parsed.pathname} ${parsed.search}`, "about_link", out, seen);
}

/**
 * Emails in a channel description. Text outside URLs is
 * channel_description. mailto: links, YouTube /redirect targets, and
 * emails inside URL query strings are about_link. Nothing is fetched.
 */
export function extractChannelContactEmails(description: string | null | undefined): FoundEmail[] {
  const text = description ?? "";
  if (!text.trim()) return [];
  const out: FoundEmail[] = [];
  const seen = new Set<string>();
  const urls = text.match(URL_PATTERN) ?? [];
  for (const url of urls) emailsInUrl(url, out, seen, 0);
  const withoutUrls = text.replace(URL_PATTERN, " ");
  emailsInText(withoutUrls, "channel_description", out, seen);
  return out;
}

/** Emails in one video description. Mailto links stay video_description. */
export function extractVideoContactEmails(description: string | null | undefined): FoundEmail[] {
  const text = description ?? "";
  if (!text.trim()) return [];
  const out: FoundEmail[] = [];
  const seen = new Set<string>();
  emailsInText(text, "video_description", out, seen);
  return out;
}
