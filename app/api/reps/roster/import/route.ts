// POST /api/reps/roster/import?mode=preview|commit
//
// Preview is the default. The agent id is the session from requireAgent.
// Writes go through supabaseAdmin inside importRoster.

import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/reps/session";
import { enforceRosterImport } from "@/lib/security/rate-limit";
import {
  RosterImportError,
  assertRosterImportBytes,
  importRoster,
  parseRosterImport,
  parseRosterMode,
} from "@/lib/reps/roster-import";

export async function POST(request: Request) {
  try {
    const gate = await requireAgent();
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const limited = await enforceRosterImport(gate.agentId);
    if (limited) return limited;

    const mode = parseRosterMode(new URL(request.url).searchParams.get("mode"));
    if (!mode) {
      return NextResponse.json({ error: "Mode must be preview or commit." }, { status: 400 });
    }

    const bytes = await readCappedRosterBody(request);
    const contentType = request.headers.get("content-type") ?? "";
    const text = new TextDecoder("utf-8").decode(bytes);
    const rows = parseRosterImport(text, contentTypeForParse(contentType, text));
    const result = await importRoster({ agentId: gate.agentId, mode, rows });
    return NextResponse.json({ mode, rows: result });
  } catch (error) {
    if (error instanceof RosterImportError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(
      "Roster import failed:",
      error instanceof Error ? error.name : "error"
    );
    return NextResponse.json({ error: "Roster import failed." }, { status: 500 });
  }
}

/** Digits only. A missing or non-numeric Content-Length is not trusted. */
function declaredContentLength(request: Request): number | null {
  const raw = request.headers.get("content-length");
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

/**
 * Reject an oversized Content-Length before any read. Then count bytes
 * as they arrive and stop once the running total passes the cap, so a
 * missing or low Content-Length cannot buffer the rest of the upload.
 */
async function readCappedRosterBody(request: Request): Promise<Uint8Array> {
  const declared = declaredContentLength(request);
  if (declared !== null) assertRosterImportBytes(declared);

  const stream = request.body;
  if (!stream) {
    assertRosterImportBytes(0);
    return new Uint8Array();
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      assertRosterImportBytes(total);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  assertRosterImportBytes(bytes.byteLength);
  return bytes;
}

function contentTypeForParse(contentType: string, text: string): string {
  const type = contentType.toLowerCase();
  if (type.includes("application/json")) return "application/json";
  if (type.includes("text/csv") || type.includes("text/plain")) return "text/csv";
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "application/json";
  return "text/csv";
}
