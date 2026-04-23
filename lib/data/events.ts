// Append-only domain event log.
//
// Every state transition that matters for audit, analytics, or future
// agent/webhook subscribers gets logged here. Fat payloads (full entity
// snapshot at event time) so historical replay never needs to reconstruct
// state from joins. Service role bypasses RLS — these writes happen from
// trusted server-side handlers only.
//
// CRITICAL: logEvent must NEVER throw or block the main transaction. If the
// event log write fails, we record it server-side and move on. Losing an
// audit row is bad; failing the transaction it documents is worse.

import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  DomainEvent,
  DomainEventType,
  DomainEntityType,
} from "./types";

export interface LogEventInput {
  eventType: DomainEventType;
  entityType: DomainEntityType;
  entityId: string;
  actorId?: string | null;
  payload: Record<string, unknown>;
  schemaVersion?: string;
}

export async function logEvent(input: LogEventInput): Promise<DomainEvent | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("domain_events")
      .insert({
        event_type: input.eventType,
        entity_type: input.entityType,
        entity_id: input.entityId,
        actor_id: input.actorId ?? null,
        payload: input.payload,
        schema_version: input.schemaVersion ?? "v1",
      })
      .select()
      .single();
    if (error) {
      console.error(
        "[events.logEvent] insert failed:",
        error.message,
        error.code,
        "type=",
        input.eventType
      );
      return null;
    }
    return data as DomainEvent;
  } catch (err) {
    console.error(
      "[events.logEvent] threw:",
      err instanceof Error ? err.message : err,
      "type=",
      input.eventType
    );
    return null;
  }
}

/**
 * Test helper — list events for an entity. Read uses service role so RLS
 * is bypassed. UI surfaces should NEVER call this directly until we add a
 * scoped read policy in a later wave.
 */
export async function listEventsForEntity(
  entityType: DomainEntityType,
  entityId: string
): Promise<DomainEvent[]> {
  const { data, error } = await supabaseAdmin
    .from("domain_events")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data as DomainEvent[];
}
