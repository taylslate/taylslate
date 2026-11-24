// Strip emails, phone numbers, and contact links from text one side
// writes to the other. Locked until the IO is signed. No I/O.

const MAX_INPUT = 20000;
const REMOVED = "[contact removed]";

const MAILTO = /(?:mailto:|tel:|sms:)[^\s<>"']+/gi;

const CONTACT_HOST =
  /(?:https?:\/\/)?(?:www\.)?(?:wa\.me|api\.whatsapp\.com|t\.me|telegram\.me|signal\.me|calendly\.com|cal\.com|linktr\.ee)(?:\/[^\s<>"']*)?/gi;

const LINKEDIN =
  /(?:https?:\/\/)?(?:[a-z0-9-]{1,63}\.){0,3}linkedin\.com\/in\/[^\s<>"']*/gi;

const URL = /https?:\/\/[^\s<>"']+/gi;

const EMAIL =
  /[a-z0-9](?:[a-z0-9._%+-]{0,62})?(?:\s*@\s*|\s*(?:\[at\]|\(at\)|\bat\b)\s*)[a-z0-9](?:[a-z0-9.-]{0,251})?(?:\s*(?:\.|\[dot\]|\(dot\)|\bdot\b)\s*[a-z0-9](?:[a-z0-9-]{0,62})?)+/gi;

const DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const MONEY = /\$\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\$\d+(?:\.\d{1,2})?/g;

export const CONTACT_STRIP_PATTERNS = [
  { name: "mailto", source: MAILTO.source },
  { name: "contact_host", source: CONTACT_HOST.source },
  { name: "linkedin", source: LINKEDIN.source },
  { name: "url", source: URL.source },
  { name: "email", source: EMAIL.source },
] as const;

function replaceAll(input: string, pattern: RegExp, value: string): string {
  pattern.lastIndex = 0;
  return input.replace(pattern, value);
}

function hostBoundary(input: string, index: number): boolean {
  if (index <= 0) return true;
  const prev = input[index - 1];
  return /[\s<>"'(]/.test(prev);
}

function replaceHosts(input: string): string {
  CONTACT_HOST.lastIndex = 0;
  return input.replace(CONTACT_HOST, (match, offset: number) => {
    if (!hostBoundary(input, offset)) return match;
    return REMOVED;
  });
}

function urlHasContact(url: string): boolean {
  const cut = url.indexOf("://");
  const rest = cut >= 0 ? url.slice(cut + 3) : url;
  const pathAt = rest.indexOf("/");
  const queryAt = rest.indexOf("?");
  const start = pathAt >= 0 ? pathAt : queryAt;
  if (start < 0) return false;
  const hay = rest.slice(start);
  if (hay.includes("@")) return true;
  return /\b(?:\[at\]|\(at\)|\bat\b)\b/i.test(hay);
}

function replaceContactUrls(input: string): string {
  URL.lastIndex = 0;
  return input.replace(URL, (match) => (urlHasContact(match) ? REMOVED : match));
}

function stripPhones(input: string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const startChar = input[i];
    if (startChar === "+" || startChar === "(" || isDigit(startChar)) {
      let j = i;
      if (input[j] === "+") j += 1;
      let digits = 0;
      let seps = 0;
      while (j < input.length) {
        const char = input[j];
        if (isDigit(char)) {
          digits += 1;
          j += 1;
          continue;
        }
        if (char === " " || char === "." || char === "-" || char === "(" || char === ")") {
          seps += 1;
          j += 1;
          continue;
        }
        break;
      }
      const scanEnd = j;
      while (j > i && isPhoneSep(input[j - 1])) {
        j -= 1;
        seps -= 1;
      }
      const spanned = input.slice(i, j);
      if (digits >= 7 && (seps > 0 || startChar === "+") && !isDateLike(spanned)) {
        out += REMOVED;
        i = j;
        continue;
      }
      // A shorter slice of a run that did not qualify cannot qualify.
      out += input.slice(i, scanEnd);
      i = scanEnd;
      continue;
    }
    out += input[i];
    i += 1;
  }
  return out;
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function isPhoneSep(char: string): boolean {
  return char === " " || char === "." || char === "-" || char === "(" || char === ")";
}

function isDateLike(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function protect(input: string): { text: string; tokens: string[] } {
  const tokens: string[] = [];
  const stash = (match: string) => {
    const token = `\u0001${tokens.length}\u0001`;
    tokens.push(match);
    return token;
  };
  DATE.lastIndex = 0;
  MONEY.lastIndex = 0;
  const dated = input.replace(DATE, stash);
  const text = dated.replace(MONEY, stash);
  return { text, tokens };
}

function restore(input: string, tokens: string[]): string {
  return input.replace(/\u0001(\d+)\u0001/g, (_match, index: string) => tokens[Number(index)] ?? "");
}

export function stripContactDetails(
  text: string,
  opts: { unlocked: boolean }
): { text: string; removed: boolean } {
  if (opts.unlocked) return { text, removed: false };
  const capped = text.length > MAX_INPUT ? text.slice(0, MAX_INPUT) : text;
  const saved = protect(capped);
  let next = saved.text;
  next = replaceAll(next, MAILTO, REMOVED);
  next = replaceHosts(next);
  next = replaceAll(next, LINKEDIN, REMOVED);
  next = replaceContactUrls(next);
  if (/@|\[at\]|\(at\)|\bat\b/i.test(next)) next = replaceAll(next, EMAIL, REMOVED);
  next = stripPhones(next);
  next = restore(next, saved.tokens);
  return { text: next, removed: next !== capped };
}
