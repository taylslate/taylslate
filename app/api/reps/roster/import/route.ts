// POST /api/reps/roster/import?mode=preview|commit
//
// Preview is the default. The agent id is the session from requireAgent.
// Writes go through supabaseAdmin inside importRoster.
//
// lib/api/rate-limit.ts counts api_keys.id. api_rate_windows.key_id
// references that table, so a session agent id is not a valid key.
// This route does not call it and does not add another limiter.

import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/reps/session";
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

    const mode = parseRosterMode(new URL(request.url).searchParams.get("mode"));
    if (!mode) {
      return NextResponse.json({ error: "Mode must be preview or commit." }, { status: 400 });
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    assertRosterImportBytes(bytes.byteLength);

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

function contentTypeForParse(contentType: string, text: string): string {
  const type = contentType.toLowerCase();
  if (type.includes("application/json")) return "application/json";
  if (type.includes("text/csv") || type.includes("text/plain")) return "text/csv";
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "application/json";
  return "text/csv";
}
