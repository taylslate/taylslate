import { NextResponse } from "next/server";

export function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status });
}

export async function readJson(
  request: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, response: jsonError("Invalid JSON.", 400) };
    }
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, response: jsonError("Invalid JSON.", 400) };
  }
}

const PGRST_SINGLE_ROW = "JSON object requested, multiple (or no) rows returned";

function isMissingRow(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code === "PGRST116") return true;
  // lib/crm/store.ts throws new Error(error.message) from .single(), which
  // drops the PostgREST code. The single-row message is that same PGRST116.
  return record.message === PGRST_SINGLE_ROW;
}

export function crmFailure(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "";
  if (message === "not signed in") return jsonError("Sign in required.", 401);
  if (message === "brandId does not match the signed-in user") {
    return jsonError("CRM is for brand accounts.", 403);
  }
  if (message === "contact not found") return jsonError("Contact not found.", 404);
  if (message === "note not found") return jsonError("Note not found.", 404);
  if (isMissingRow(error)) return jsonError("Not found", 404);

  const lower = message.toLowerCase();
  if (
    lower.includes("is required") ||
    lower.includes("must be") ||
    lower.includes("is not valid") ||
    lower.includes("nothing to update") ||
    lower.includes("between 1 and")
  ) {
    const sentence = message.endsWith(".") ? message : `${message}.`;
    return jsonError(sentence.charAt(0).toUpperCase() + sentence.slice(1), 400);
  }

  console.error("[crm]", error);
  return jsonError("CRM request failed.", 500);
}
