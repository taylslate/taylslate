// One conversation. A missing id and another brand's id are both 404.
// DELETE removes the conversation and its messages. It does not
// touch api_write_actions.

import { NextResponse } from "next/server";
import { requireBrand } from "@/lib/api/approvals/list";
import { isSameOriginRequest } from "@/lib/api/approvals/decide";
import {
  deleteConversation,
  getConversation,
  listMessages,
  turnIsFresh,
  type ConversationRow,
  type MessageRow,
} from "@/lib/command-agent/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ConversationRoute = { params: Promise<{ id: string }> };

export async function GET(_request: Request, route: ConversationRoute) {
  const actor = await requireBrand();
  if (!actor.ok) return json({ error: actor.error }, actor.httpStatus);
  const { id } = await route.params;
  const found = await getConversation(actor.userId, id);
  if (!found.ok) return json({ error: "Could not load the conversation." }, 500);
  if (!found.row) return json({ error: "Not found." }, 404);
  const messages = await listMessages(actor.userId, found.row.id);
  if (!messages) return json({ error: "Could not load the conversation." }, 500);
  return json({
    conversation: publicConversation(found.row),
    messages: messages.map(publicMessage),
  });
}

export async function DELETE(request: Request, route: ConversationRoute) {
  const actor = await requireBrand();
  if (!actor.ok) return json({ error: actor.error }, actor.httpStatus);
  if (!isSameOriginRequest(request)) return json({ error: "Forbidden" }, 403);
  const { id } = await route.params;
  const found = await getConversation(actor.userId, id);
  if (!found.ok) return json({ error: "Could not load the conversation." }, 500);
  if (!found.row) return json({ error: "Not found." }, 404);
  if (turnIsFresh(found.row.turn_started_at)) {
    return json({ error: "Tay is already working on a message." }, 409);
  }
  const removed = await deleteConversation(actor.userId, id);
  if (removed === "error") return json({ error: "Could not delete the conversation." }, 500);
  if (removed === "missing") return json({ error: "Not found." }, 404);
  return json({ ok: true });
}

function publicConversation(row: ConversationRow) {
  return {
    id: row.id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function publicMessage(row: MessageRow) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    action_ids: row.action_ids,
    created_at: row.created_at,
  };
}

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
