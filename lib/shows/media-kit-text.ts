// ============================================================
// MEDIA-KIT UPLOAD TEXT
//
// Turns an uploaded file into the string the geography parser reads.
// Plain text is returned as-is. PDFs contribute the literal strings
// in their content streams (FlateDecode streams are inflated). A PDF
// with no extractable text returns "" — the caller asks the show to
// paste the geography section instead of guessing.
//
// Never throws.
// ============================================================

import { inflateSync } from "node:zlib";

const MAX_STREAMS = 40;

export function extractKitText(input: Buffer | string): string {
  try {
    const buf = typeof input === "string" ? Buffer.from(input) : input;
    if (buf.length === 0) return "";
    const head = buf.subarray(0, 5).toString("latin1");
    if (head !== "%PDF-") return buf.toString("utf8");
    return extractPdfStrings(buf);
  } catch {
    return "";
  }
}

function extractPdfStrings(pdf: Buffer): string {
  const chunks: string[] = [];
  let searchFrom = 0;
  let streams = 0;

  while (streams < MAX_STREAMS) {
    const marker = pdf.indexOf("stream", searchFrom);
    if (marker === -1) break;
    streams++;
    let bodyStart = marker + "stream".length;
    if (pdf[bodyStart] === 0x0d && pdf[bodyStart + 1] === 0x0a) bodyStart += 2;
    else if (pdf[bodyStart] === 0x0a) bodyStart += 1;

    const end = pdf.indexOf("endstream", bodyStart);
    if (end === -1) break;

    const dict = pdf.subarray(Math.max(0, marker - 400), marker).toString("latin1");
    let body: Buffer = pdf.subarray(bodyStart, end);
    if (/\/FlateDecode\b/.test(dict)) {
      const inflated = inflateStream(body);
      if (inflated) body = inflated;
      else {
        searchFrom = end + "endstream".length;
        continue;
      }
    }

    const text = body.toString("latin1");
    const strings = readPdfStrings(text);
    if (strings) chunks.push(strings);
    searchFrom = end + "endstream".length;
  }

  return chunks.join("\n").replace(/\s+/g, " ").trim();
}

function inflateStream(body: Buffer): Buffer | null {
  const trimmed = trimStreamTail(body);
  try {
    return inflateSync(trimmed);
  } catch {
    return null;
  }
}

/** Drop the newline PDF writers put between the stream bytes and endstream. */
function trimStreamTail(body: Buffer): Buffer {
  let end = body.length;
  if (end > 0 && body[end - 1] === 0x0a) end--;
  if (end > 0 && body[end - 1] === 0x0d) end--;
  return body.subarray(0, end);
}

function readPdfStrings(content: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < content.length) {
    if (content[i] !== "(") {
      i++;
      continue;
    }
    i++;
    let depth = 1;
    let piece = "";
    while (i < content.length && depth > 0) {
      const ch = content[i];
      if (ch === "\\") {
        const next = content[i + 1];
        if (next === "n") piece += "\n";
        else if (next === "r") piece += "\r";
        else if (next === "t") piece += "\t";
        else if (next === "(" || next === ")" || next === "\\") piece += next;
        else if (next !== undefined) piece += next;
        i += next === undefined ? 1 : 2;
        continue;
      }
      if (ch === "(") {
        depth++;
        piece += ch;
        i++;
        continue;
      }
      if (ch === ")") {
        depth--;
        i++;
        if (depth === 0) break;
        piece += ch;
        continue;
      }
      piece += ch;
      i++;
    }
    const cleaned = piece.replace(/\s+/g, " ").trim();
    if (cleaned) out.push(cleaned);
  }
  return out.join(" ");
}
