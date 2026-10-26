// POST /api/admin/roster-links/[id]
// Body { action: "approve" } calls approveRosterLink.
// Body { action: "reject", note } rejects a pending link only.
// A non-admin is 403. A link that is not pending returns "Not pending".

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { approveRosterLink } from "@/lib/reps/store";
import { rejectRosterLink } from "@/lib/reps/roster-review";
import { isShowsAdmin } from "@/lib/shows/can-edit-show";

export const runtime = "nodejs";

async function requireShowsAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!(await isShowsAdmin(user.id))) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, userId: user.id };
}

function isNotPending(message: string): boolean {
  return (
    /not pending/i.test(message) ||
    /cannot coerce the result to a single json object/i.test(message) ||
    /json object requested, multiple \(or no\) rows returned/i.test(message)
  );
}

function failureResponse(error: unknown, fallback: string): NextResponse {
  const message = error instanceof Error ? error.message : "";
  if (/note of 1 to 500/i.test(message)) {
    return NextResponse.json(
      { error: "A note of 1 to 500 characters is required." },
      { status: 400 }
    );
  }
  if (isNotPending(message)) {
    return NextResponse.json({ error: "Not pending" }, { status: 409 });
  }
  if (/only an admin/i.test(message)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (/review_note|rejected_by|rejected_at/i.test(message)) {
    return NextResponse.json(
      { error: "Roster review notes are not available yet." },
      { status: 503 }
    );
  }
  console.error("[roster-links]", message || fallback);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireShowsAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (typeof id !== "string" || id.trim() === "") {
    return NextResponse.json({ error: "Missing roster link" }, { status: 400 });
  }

  let body: { action?: unknown; note?: unknown };
  try {
    body = (await request.json()) as { action?: unknown; note?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action === "approve") {
    try {
      const approved = await approveRosterLink(gate.userId, id);
      return NextResponse.json(approved);
    } catch (error) {
      return failureResponse(error, "Couldn't approve that link.");
    }
  }

  if (body.action === "reject") {
    try {
      const rejected = await rejectRosterLink(gate.userId, id, body.note);
      return NextResponse.json(rejected);
    } catch (error) {
      return failureResponse(error, "Couldn't reject that link.");
    }
  }

  return NextResponse.json({ error: "Action must be approve or reject" }, { status: 400 });
}
