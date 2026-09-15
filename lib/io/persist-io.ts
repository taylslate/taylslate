// Persist the insertion_orders + io_line_items rows for a DocuSign-flow deal.
//
// Invariant this module exists to enforce: a document cannot go out for
// signature without a database record. send-to-docusign calls this BEFORE
// creating the envelope; if persistence fails there is no envelope and no
// signing URL. The rows written here are exactly the RenderedIo.lineItems the
// PDF table was rendered from, so the signed document and the DB never
// disagree — io_line_items.gross_rate is the amount chargeForEpisode bills.
//
// Idempotency: the deal-derived io_number (IO-{first 8 chars of deal id}) is
// globally UNIQUE, so it doubles as the concurrency sentinel. A 23505 on
// insert means a concurrent request won the race — refetch and return WITHOUT
// touching line items (the winner may still be mid-insert; a "repair" here
// would duplicate rows).
//
// Repair: an existing IO with a wrong line-item count (partial past insert)
// is healed by delete+reinsert ONLY when nothing references the items —
// payments.io_line_item_id and invoice_line_items.io_line_item_id are both
// NO ACTION FKs, and chargeForEpisode never checks `verified`, so an
// unverified item can still carry a payment. Blocked repairs fire the
// io.repair_skipped tripwire and keep the existing rows.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/data/events";
import type { IoLineItemDraft } from "@/lib/pdf/io-generator";
import type { IOStatus } from "@/lib/data/types";

export interface PersistIoContacts {
  advertiserName: string;
  advertiserContactEmail?: string | null;
  publisherName: string;
  publisherContactName: string;
  publisherContactEmail: string;
}

/** Backfill hook: historical rows carry their original send/sign timestamps. */
export interface PersistIoOverrides {
  status?: IOStatus;
  sentAt?: string;
  signedAt?: string | null;
}

export interface PersistIoInput {
  dealId: string;
  rendered: {
    ioNumber: string;
    totalGross: number;
    totalNet: number;
    totalDownloads: number;
    lineItems: IoLineItemDraft[];
  };
  contacts: PersistIoContacts;
  actorId?: string | null;
  /** Provenance recorded on the io.persisted event. */
  source?: string;
  overrides?: PersistIoOverrides;
}

export interface PersistIoResult {
  ioId: string;
  ioNumber: string;
  created: boolean;
  repaired: boolean;
  lineItemCount: number;
}

export async function persistIoForDeal(
  input: PersistIoInput
): Promise<PersistIoResult> {
  const { dealId, rendered, contacts, actorId, overrides } = input;
  const source = input.source ?? "send_to_docusign";
  const drafts = rendered.lineItems;
  const ioNumber = rendered.ioNumber;

  // ---- Guards: block at send, not at charge ----
  if (drafts.length === 0) {
    throw new Error(
      `Refusing to persist IO ${ioNumber} for deal ${dealId}: no line items (agreed_episode_count is 0?)`
    );
  }
  if (drafts.some((li) => !li.post_date)) {
    throw new Error(
      `Refusing to persist IO ${ioNumber} for deal ${dealId}: line items are missing post dates (unparseable flight window?)`
    );
  }
  if (drafts.some((li) => !(li.gross_rate > 0))) {
    throw new Error(
      `Refusing to persist IO ${ioNumber} for deal ${dealId}: $0 line items — is the show's audience_size missing? A $0 gross_rate can never be charged.`
    );
  }

  // ---- Existence check by io_number (NOT deal_id: a legacy IO-{year}-NNNN ----
  // row on the same deal must never be "repaired" into DocuSign-derived values)
  const { data: existing, error: exErr } = await supabaseAdmin
    .from("insertion_orders")
    .select("id, deal_id")
    .eq("io_number", ioNumber)
    .maybeSingle();
  if (exErr) {
    throw new Error(`insertion_orders lookup failed for ${ioNumber}: ${exErr.message}`);
  }
  if (existing) {
    if (existing.deal_id !== dealId) {
      // 8-hex-char cross-deal collision. Astronomically unlikely; fail loudly
      // rather than attach this deal's signing flow to someone else's IO.
      throw new Error(
        `IO number collision: ${ioNumber} already belongs to deal ${existing.deal_id}`
      );
    }
    return reconcileExisting(existing.id, input, source);
  }

  // ---- Fresh insert ----
  const { data: ioRow, error: insErr } = await supabaseAdmin
    .from("insertion_orders")
    .insert({
      io_number: ioNumber,
      deal_id: dealId,
      advertiser_name: contacts.advertiserName,
      advertiser_contact_email: contacts.advertiserContactEmail ?? null,
      publisher_name: contacts.publisherName,
      publisher_contact_name: contacts.publisherContactName,
      publisher_contact_email: contacts.publisherContactEmail,
      total_downloads: rendered.totalDownloads,
      total_gross: rendered.totalGross,
      total_net: rendered.totalNet,
      payment_terms: "Pay-as-delivers via Taylslate",
      status: overrides?.status ?? "sent",
      sent_at: overrides?.sentAt ?? new Date().toISOString(),
      signed_at: overrides?.signedAt ?? null,
    })
    .select("id")
    .single();

  if (insErr || !ioRow) {
    if (insErr?.code === "23505") {
      // Concurrent request won the io_number race. Terminal success — do NOT
      // inspect or repair line items; the winner may still be inserting them.
      const { data: winner, error: winErr } = await supabaseAdmin
        .from("insertion_orders")
        .select("id, deal_id")
        .eq("io_number", ioNumber)
        .maybeSingle();
      if (!winErr && winner && winner.deal_id === dealId) {
        return {
          ioId: winner.id,
          ioNumber,
          created: false,
          repaired: false,
          lineItemCount: drafts.length,
        };
      }
      throw new Error(
        `IO ${ioNumber} hit a unique violation but no row for deal ${dealId} exists — cross-deal collision?`
      );
    }
    throw new Error(
      `insertion_orders insert failed for ${ioNumber}: ${insErr?.message ?? "no row returned"}`
    );
  }

  const { data: insertedItems, error: liErr } = await supabaseAdmin
    .from("io_line_items")
    .insert(drafts.map((li) => ({ ...li, io_id: ioRow.id })))
    .select("id");

  if (liErr || (insertedItems?.length ?? 0) !== drafts.length) {
    // Partial persist is the exact bug this module exists to prevent — remove
    // the header row (cascade sweeps any inserted items) and abort the send.
    await supabaseAdmin.from("insertion_orders").delete().eq("id", ioRow.id);
    throw new Error(
      `io_line_items insert failed for ${ioNumber} (${insertedItems?.length ?? 0}/${drafts.length}): ${liErr?.message ?? "count mismatch"}`
    );
  }

  await logEvent({
    eventType: "io.persisted",
    entityType: "deal",
    entityId: dealId,
    actorId: actorId ?? null,
    payload: {
      io_id: ioRow.id,
      io_number: ioNumber,
      line_item_count: drafts.length,
      total_gross: rendered.totalGross,
      total_net: rendered.totalNet,
      source,
      repaired: false,
    },
  });

  return {
    ioId: ioRow.id,
    ioNumber,
    created: true,
    repaired: false,
    lineItemCount: drafts.length,
  };
}

async function reconcileExisting(
  ioId: string,
  input: PersistIoInput,
  source: string
): Promise<PersistIoResult> {
  const { dealId, rendered, actorId } = input;
  const drafts = rendered.lineItems;
  const ioNumber = rendered.ioNumber;

  const { data: items, error: itemsErr } = await supabaseAdmin
    .from("io_line_items")
    .select("id, verified")
    .eq("io_id", ioId);
  if (itemsErr) {
    throw new Error(
      `io_line_items lookup failed for IO ${ioNumber}: ${itemsErr.message}`
    );
  }
  const existingItems = items ?? [];

  if (existingItems.length === drafts.length) {
    return {
      ioId,
      ioNumber,
      created: false,
      repaired: false,
      lineItemCount: existingItems.length,
    };
  }

  // ---- Repair guard ----
  let blockedBy: string | null = null;
  if (existingItems.some((i) => i.verified)) {
    blockedBy = "verified_line_items";
  }
  const itemIds = existingItems.map((i) => i.id);
  if (!blockedBy && itemIds.length > 0) {
    const { data: payRefs, error: payErr } = await supabaseAdmin
      .from("payments")
      .select("id")
      .in("io_line_item_id", itemIds)
      .limit(1);
    // A guard check we can't evaluate means we can't prove the repair is
    // safe — abort the send rather than risk orphaning a payment reference.
    if (payErr) {
      throw new Error(
        `payments reference check failed for IO ${ioNumber}: ${payErr.message}`
      );
    }
    if ((payRefs?.length ?? 0) > 0) blockedBy = "payments_reference";
  }
  if (!blockedBy && itemIds.length > 0) {
    const { data: invRefs, error: invErr } = await supabaseAdmin
      .from("invoice_line_items")
      .select("id")
      .in("io_line_item_id", itemIds)
      .limit(1);
    if (invErr) {
      throw new Error(
        `invoice reference check failed for IO ${ioNumber}: ${invErr.message}`
      );
    }
    if ((invRefs?.length ?? 0) > 0) blockedBy = "invoice_reference";
  }

  if (blockedBy) {
    // The IO record exists, so the signing invariant holds — proceed with the
    // send, but leave a loud trail: the line-item set doesn't match the
    // document being signed.
    console.error(
      `[persist-io] IO ${ioNumber} has ${existingItems.length} line items (expected ${drafts.length}) but repair is blocked by ${blockedBy}`
    );
    await logEvent({
      eventType: "io.repair_skipped",
      entityType: "deal",
      entityId: dealId,
      actorId: actorId ?? null,
      payload: {
        io_id: ioId,
        io_number: ioNumber,
        existing_count: existingItems.length,
        expected_count: drafts.length,
        blocked_by: blockedBy,
        source,
      },
    });
    return {
      ioId,
      ioNumber,
      created: false,
      repaired: false,
      lineItemCount: existingItems.length,
    };
  }

  // ---- Repair: delete + reinsert ----
  if (itemIds.length > 0) {
    const { error: delErr } = await supabaseAdmin
      .from("io_line_items")
      .delete()
      .eq("io_id", ioId);
    if (delErr) {
      throw new Error(
        `io_line_items repair delete failed for IO ${ioNumber}: ${delErr.message}`
      );
    }
  }
  const { data: reinserted, error: reErr } = await supabaseAdmin
    .from("io_line_items")
    .insert(drafts.map((li) => ({ ...li, io_id: ioId })))
    .select("id");
  if (reErr || (reinserted?.length ?? 0) !== drafts.length) {
    // IO row is left with an incomplete item set; the send aborts and the
    // next attempt re-enters this repair path.
    throw new Error(
      `io_line_items repair insert failed for IO ${ioNumber} (${reinserted?.length ?? 0}/${drafts.length}): ${reErr?.message ?? "count mismatch"}`
    );
  }

  await logEvent({
    eventType: "io.persisted",
    entityType: "deal",
    entityId: dealId,
    actorId: actorId ?? null,
    payload: {
      io_id: ioId,
      io_number: ioNumber,
      line_item_count: drafts.length,
      total_gross: rendered.totalGross,
      total_net: rendered.totalNet,
      source,
      repaired: true,
    },
  });

  return {
    ioId,
    ioNumber,
    created: false,
    repaired: true,
    lineItemCount: drafts.length,
  };
}
