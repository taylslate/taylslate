// Conversation list and a new conversation. Brand role only.
// Nothing here runs a model turn.

import { NextResponse } from "next/server";
import { requireBrand } from "@/lib/api/approvals/list";
import { isSameOriginRequest } from "@/lib/api/approvals/decide";
import { parseCreateBody, readLimitedJson } from "@/lib/command-agent/limits";
import { createConversation, listConversations, type ConversationRow } from "@/lib/command-agent/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const actor = await requireBrand();
  if (!actor.ok) return json({ error: actor.error }, actor.httpStatus);
  const rows = await listConversations(actor.userId);
  if (!rows) return json({ error: "Could not load conversations." }, 500);
  return json({ conversations: rows.map(publicConversation) });
}

export async function POST(request: Request) {
  const actor = await requireBrand();
  if (!actor.ok) return json({ error: actor.error }, actor.httpStatus);
  if (!isSameOriginRequest(request)) return json({ error: "Forbidden" }, 403);
  const body = await readLimitedJson(request);
  if (!body.ok) return json({ error: body.error }, body.status);
  const parsed = parseCreateBody(body.value);
  if (!parsed.ok) return json({ error: parsed.error }, 422);
  const created = await createConversation(actor.userId, parsed.title);
  if (!created) return json({ error: "Could not start a conversation." }, 500);
  return json({ conversation: publicConversation(created) });
}

function publicConversation(row: ConversationRow) {
  return {
    id: row.id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
