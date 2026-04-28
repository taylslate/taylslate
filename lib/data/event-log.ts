// Per-customer metering / analytics event log (Wave 13).
//
// This is NOT the domain audit log — that's `lib/data/events.ts:logEvent`,
// which captures state transitions of business entities (deals, envelopes,
// outreach) with fat payloads. `recordEvent` captures fine-grained product
// usage signals per customer (a campaign was generated, a discovery run was
// fired, an IO was rendered, an outreach was sent, an API call was made).
//
// CRITICAL: recordEvent must NEVER throw or block the main transaction.
// Metering rows are valuable for billing/analytics, but losing one is far
// less bad than failing the user-facing operation it documents. Same
// fail-soft pattern as logEvent.
//
// TODO: also fire from the MCP server when API endpoints land — every API
// call should produce an `api_call` event_log row carrying the operation
// the agent invoked.

import { supabaseAdmin } from "@/lib/supabase/admin";

export type OperationType =
  | "campaign_generated"
  | "discovery_run"
  | "io_generated"
  | "outreach_sent"
  | "api_call"
  | "conversion_alert_sent";

export interface RecordEventInput {
  customerId: string | null | undefined;
  operationType: OperationType;
  metadata?: Record<string, unknown>;
}

export async function recordEvent(input: RecordEventInput): Promise<void> {
  if (!input.customerId) {
    // No customer context — skip silently. Some legacy paths may lack a
    // user (cron, internal jobs); those should pass an explicit customer
    // id when they have one and accept the no-op when they don't.
    return;
  }
  try {
    const { error } = await supabaseAdmin.from("event_log").insert({
      customer_id: input.customerId,
      operation_type: input.operationType,
      metadata: input.metadata ?? {},
    });
    if (error) {
      console.warn(
        "[event-log.recordEvent] insert failed:",
        error.message,
        error.code,
        "op=",
        input.operationType
      );
    }
  } catch (err) {
    console.warn(
      "[event-log.recordEvent] threw:",
      err instanceof Error ? err.message : err,
      "op=",
      input.operationType
    );
  }
}

/**
 * Test/analytics helper — list event_log rows for a customer, optionally
 * filtered by operation type and time window. Service-role only; UI must
 * not call this directly until a scoped SELECT policy ships.
 */
export async function listEventsForCustomer(
  customerId: string,
  options?: {
    operationType?: OperationType;
    sinceIso?: string;
  }
): Promise<
  Array<{
    id: string;
    customer_id: string;
    timestamp: string;
    operation_type: OperationType;
    metadata: Record<string, unknown>;
  }>
> {
  let query = supabaseAdmin
    .from("event_log")
    .select("*")
    .eq("customer_id", customerId)
    .order("timestamp", { ascending: false });
  if (options?.operationType) {
    query = query.eq("operation_type", options.operationType);
  }
  if (options?.sinceIso) {
    query = query.gte("timestamp", options.sinceIso);
  }
  const { data, error } = await query;
  if (error || !data) return [];
  return data as Array<{
    id: string;
    customer_id: string;
    timestamp: string;
    operation_type: OperationType;
    metadata: Record<string, unknown>;
  }>;
}
