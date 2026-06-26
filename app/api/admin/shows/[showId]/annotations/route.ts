// POST /api/admin/shows/[showId]/annotations
//
// Founder-only: capture a free-text "why this show is right / wrong-ring"
// annotation against a show (Wave 14 Phase 2D Layer 1). This is moat / learning
// signal that metadata can't infer — surfaced inline on the discovery cards and
// fed into future ring location.
//
// Auth: INTERNAL_ADMIN_EMAILS allowlist only (same gate as mark-delivered).
// Brands never reach this; annotations are admin-only and not brand-facing.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { isInternalAdmin } from "@/lib/auth/admin";
import { recordFounderAnnotation } from "@/lib/data/reasoning-log";

export const runtime = "nodejs";

interface AnnotationBody {
  note?: unknown;
  tags?: unknown;
}

const MAX_NOTE_LEN = 2000;
const MAX_TAGS = 12;
const MAX_TAG_LEN = 40;

/** Coerce arbitrary input into a clean string[] — trimmed, de-duped, capped. */
function sanitizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const trimmed = t.trim().slice(0, MAX_TAG_LEN);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ showId: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isInternalAdmin(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { showId } = await params;

  let body: AnnotationBody;
  try {
    body = (await request.json()) as AnnotationBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note) {
    return NextResponse.json({ error: "note is required" }, { status: 400 });
  }

  const id = await recordFounderAnnotation({
    showId,
    authorId: user.id,
    note: note.slice(0, MAX_NOTE_LEN),
    tags: sanitizeTags(body.tags),
  });
  if (!id) {
    return NextResponse.json(
      { error: "Failed to save annotation" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, id }, { status: 201 });
}
