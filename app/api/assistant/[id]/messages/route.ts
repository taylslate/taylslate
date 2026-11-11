// One user message and one Tay turn. Writes stay pending.
// A second turn on the same conversation is 409.

import { NextResponse } from "next/server";
import { requireBrand } from "@/lib/api/approvals/list";
import { isSameOriginRequest } from "@/lib/api/approvals/decide";
import { enforceRules } from "@/lib/security/rate-limit";
import { logEvent } from "@/lib/data/events";
import {
  DAILY_CAP_MESSAGE,
  DAILY_TOKEN_CAP,
  commandAgentRules,
  parseMessageBody,
  readLimitedJson,
  utcDayStart,
} from "@/lib/command-agent/limits";
import { runAgentTurn } from "@/lib/command-agent/run";
import {
  claimTurn,
  getConversation,
  insertMessage,
  releaseTurn,
  setTitleIfEmpty,
  sumTokensSince,
  type MessageRow,
} from "@/lib/command-agent/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type MessageRoute = { params: Promise<{ id: string }> };

export async function POST(request: Request, route: MessageRoute) {
  const actor = await requireBrand();
  if (!actor.ok) return json({ error: actor.error }, actor.httpStatus);
  if (!isSameOriginRequest(request)) return json({ error: "Forbidden" }, 403);

  const limited = await enforceRules({
    rules: commandAgentRules(actor.userId),
    failureMode: "closed",
  });
  if (limited) {
    limited.headers.set("Cache-Control", "no-store");
    return limited;
  }

  const body = await readLimitedJson(request);
  if (!body.ok) return json({ error: body.error }, body.status);
  const parsed = parseMessageBody(body.value);
  if (!parsed.ok) return json({ error: parsed.error }, 422);

  const { id } = await route.params;
  const found = await getConversation(actor.userId, id);
  if (!found.ok) return json({ error: "Could not load the conversation." }, 500);
  if (!found.row) return json({ error: "Not found." }, 404);

  const spent = await sumTokensSince(actor.userId, utcDayStart());
  if (!spent.ok) return json({ error: "unavailable" }, 503);
  if (spent.total >= DAILY_TOKEN_CAP) {
    await logEvent({
      eventType: "command_agent.cap_hit",
      entityType: "command_agent_conversation",
      entityId: found.row.id,
      actorId: actor.userId,
      payload: { limit: "daily_tokens" },
    });
    console.info("[command-agent] outcome=cap_hit");
    return json({ error: DAILY_CAP_MESSAGE }, 429);
  }

  const claim = await claimTurn(actor.userId, found.row.id);
  if (claim === "missing") return json({ error: "Not found." }, 404);
  if (claim === "busy") return json({ error: "Tay is already working on a message." }, 409);
  if (claim === "error") return json({ error: "Could not start the turn." }, 503);

  try {
    const user = await insertMessage({
      brandId: actor.userId,
      conversationId: found.row.id,
      role: "user",
      content: { text: parsed.message },
    });
    if (!user) return json({ error: "Could not save the message." }, 500);
    if (!found.row.title) await setTitleIfEmpty(actor.userId, found.row.id, titleFrom(parsed.message));
    const turn = await runAgentTurn({
      brandId: actor.userId,
      conversationId: found.row.id,
      userMessageId: user.id,
    });
    if (!turn.ok) return json({ error: "Tay could not finish this turn. Try again." }, 500);
    return json({ messages: [publicMessage(user), ...turn.messages.map(publicMessage)] });
  } finally {
    await releaseTurn(actor.userId, found.row.id);
  }
}

function titleFrom(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 80 ? compact.slice(0, 80) : compact;
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
