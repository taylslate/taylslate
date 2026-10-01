// Shared delivery write + charge for one IO line.
//
// POST /api/admin/mark-delivered and the aircheck review confirm both
// call this. The charge is chargeForEpisode — gross plus the brand's
// fee, idempotent on (deal, line). Do not add a second charge path.
//
// A failed charge rolls the delivery write back to the pre-request
// snapshot. Callers that own an aircheck row record the error there
// and must not treat the line as confirmed.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { chargeForEpisode, type ChargeForEpisodeResult } from "@/lib/stripe/payment-intent";
import { logEvent } from "@/lib/data/events";

export interface DeliverAndChargeInput {
  ioLineItemId: string;
  actualPostDate?: string;
  actualDownloads?: number;
}

interface IoLineItemRow {
  id: string;
  io_id: string;
  verified: boolean;
  actual_post_date: string | null;
  actual_downloads: number | null;
}

interface IoRow {
  id: string;
  deal_id: string;
}

export type DeliverAndChargeResult =
  | { ok: true; charge: ChargeForEpisodeResult }
  | {
      ok: false;
      status: 404 | 500;
      error: string;
    }
  | {
      ok: false;
      status: 502;
      chargeError: string;
      rolledBack: boolean;
      rollbackError?: string;
    };

export async function deliverAndChargeLine(
  input: DeliverAndChargeInput
): Promise<DeliverAndChargeResult> {
  const { data: lineItem, error: liErr } = await supabaseAdmin
    .from("io_line_items")
    .select("id,io_id,verified,actual_post_date,actual_downloads")
    .eq("id", input.ioLineItemId)
    .single<IoLineItemRow>();
  if (liErr || !lineItem) {
    return {
      ok: false,
      status: 404,
      error: `IO line item ${input.ioLineItemId} not found`,
    };
  }

  const { data: io, error: ioErr } = await supabaseAdmin
    .from("insertion_orders")
    .select("id,deal_id")
    .eq("id", lineItem.io_id)
    .single<IoRow>();
  if (ioErr || !io) {
    return {
      ok: false,
      status: 404,
      error: `Insertion order ${lineItem.io_id} not found`,
    };
  }

  const updates: Record<string, unknown> = { verified: true };
  if (input.actualPostDate) {
    updates.actual_post_date = input.actualPostDate;
  } else if (!lineItem.actual_post_date) {
    updates.actual_post_date = new Date().toISOString().slice(0, 10);
  }
  if (Number.isFinite(input.actualDownloads)) {
    updates.actual_downloads = input.actualDownloads;
  }
  const { error: updErr } = await supabaseAdmin
    .from("io_line_items")
    .update(updates)
    .eq("id", lineItem.id);
  if (updErr) {
    return {
      ok: false,
      status: 500,
      error: `Failed to mark delivered: ${updErr.message}`,
    };
  }

  await logEvent({
    eventType: "io_line_item.delivered",
    entityType: "io_line_item",
    entityId: lineItem.id,
    payload: {
      io_id: lineItem.io_id,
      deal_id: io.deal_id,
      previously_verified: lineItem.verified,
      ...updates,
    },
  });

  try {
    const charge = await chargeForEpisode({
      dealId: io.deal_id,
      ioLineItemId: lineItem.id,
    });
    return { ok: true, charge };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Charge failed";
    console.error(
      `[admin/mark-delivered] deal ${io.deal_id} line ${lineItem.id}:`,
      message
    );

    const { error: rollbackErr } = await supabaseAdmin
      .from("io_line_items")
      .update({
        verified: lineItem.verified,
        actual_post_date: lineItem.actual_post_date,
        actual_downloads: lineItem.actual_downloads,
      })
      .eq("id", lineItem.id);
    if (rollbackErr) {
      console.error(
        `[admin/mark-delivered] ROLLBACK FAILED for line ${lineItem.id} — delivery state is inconsistent (charge failed but verified may still be true):`,
        rollbackErr.message
      );
    }

    await logEvent({
      eventType: "io_line_item.delivery_rolled_back",
      entityType: "io_line_item",
      entityId: lineItem.id,
      payload: {
        io_id: lineItem.io_id,
        deal_id: io.deal_id,
        charge_error: message,
        rolled_back: !rollbackErr,
        restored: {
          verified: lineItem.verified,
          actual_post_date: lineItem.actual_post_date,
          actual_downloads: lineItem.actual_downloads,
        },
        ...(rollbackErr ? { rollback_error: rollbackErr.message } : {}),
      },
    });

    return {
      ok: false,
      status: 502,
      chargeError: message,
      rolledBack: !rollbackErr,
      ...(rollbackErr ? { rollbackError: rollbackErr.message } : {}),
    };
  }
}
