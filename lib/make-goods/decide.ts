// Brand decision on one make-good.
// Every write includes the deal id the caller already proved they own,
// and the make-good id must be a row on that deal. No DocuSign. No charge.

import { logEvent } from "@/lib/data/events";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { creditAmount, draftAmendedTerms, replacementPostDate } from "./terms";
import {
  asMakeGoodRecord,
  isMakeGoodOptionId,
  type MakeGoodOptionId,
  type MakeGoodRecord,
} from "./types";

const DELIVERS_AGAIN = new Set(["completed", "live", "show_signed", "signed"]);

interface IoRow {
  id: string;
  deal_id: string;
  io_number: string | null;
  advertiser_name: string | null;
  total_downloads: number | null;
}

interface LineRow {
  id: string;
  io_id: string;
  format: string | null;
  post_date: string | null;
  guaranteed_downloads: number | null;
  show_name: string | null;
  placement: string | null;
  is_scripted: boolean | null;
  is_personal_experience: boolean | null;
  reader_type: string | null;
  content_type: string | null;
  pixel_required: boolean | null;
  price_type: string | null;
  spot_format: string | null;
  gross_cpm: number | null;
  gross_rate: number | null;
  net_due: number | null;
}

export type DecideResult =
  | { ok: true; makeGood: MakeGoodRecord; dealStatus: string | null }
  | { ok: false; status: 400 | 404 | 409; error: string };

async function loadScoped(dealId: string, makeGoodId: string): Promise<MakeGoodRecord | null> {
  const { data, error } = await supabaseAdmin
    .from("make_goods")
    .select("*")
    .eq("id", makeGoodId)
    .eq("deal_id", dealId)
    .maybeSingle();
  if (error) throw new Error(`make-good lookup failed: ${error.message}`);
  return asMakeGoodRecord(data);
}

function readerType(value: string | null): string {
  if (value === "producer_read" || value === "guest_read" || value === "host_read") {
    return value;
  }
  return "host_read";
}

function contentType(value: string | null): string {
  return value === "dated" ? "dated" : "evergreen";
}

function formatOf(value: string | null): string {
  return value === "youtube" ? "youtube" : "podcast";
}

function placementOf(value: string | null): string {
  if (value === "pre-roll" || value === "post-roll" || value === "mid-roll") return value;
  return "mid-roll";
}

export async function approveMakeGood(input: {
  dealId: string;
  makeGoodId: string;
  optionId: MakeGoodOptionId;
  actorId: string;
}): Promise<DecideResult> {
  if (!isMakeGoodOptionId(input.optionId)) {
    return { ok: false, status: 400, error: "Choose a make-good option." };
  }

  const current = await loadScoped(input.dealId, input.makeGoodId);
  if (!current) {
    return { ok: false, status: 404, error: "Make-good not found on this deal." };
  }
  if (current.status !== "proposed") {
    return { ok: false, status: 409, error: "This make-good is already decided." };
  }
  const allowed = current.options.some((option) => option.id === input.optionId);
  if (!allowed) {
    return { ok: false, status: 400, error: "That option is not open on this make-good." };
  }

  const { data: io, error: ioError } = await supabaseAdmin
    .from("insertion_orders")
    .select("id, deal_id, io_number, advertiser_name, total_downloads")
    .eq("id", current.io_id)
    .eq("deal_id", input.dealId)
    .maybeSingle();
  if (ioError) throw new Error(`insertion order lookup failed: ${ioError.message}`);
  if (!io) {
    return { ok: false, status: 404, error: "Make-good not found on this deal." };
  }

  const { data: line, error: lineError } = await supabaseAdmin
    .from("io_line_items")
    .select(
      "id, io_id, format, post_date, guaranteed_downloads, show_name, placement, is_scripted, is_personal_experience, reader_type, content_type, pixel_required, price_type, spot_format, gross_cpm, gross_rate, net_due"
    )
    .eq("id", current.io_line_item_id)
    .eq("io_id", (io as IoRow).id)
    .maybeSingle();
  if (lineError) throw new Error(`line lookup failed: ${lineError.message}`);
  if (!line) {
    return { ok: false, status: 404, error: "Make-good not found on this deal." };
  }

  const source = line as LineRow;
  const addsSpot = input.optionId === "replacement_spot" || input.optionId === "reair";
  const postDate = replacementPostDate(current.post_date);
  const credit =
    input.optionId === "credit_shortfall"
      ? creditAmount(
          {
            showName: current.show_name,
            placement: current.placement,
            postDate: current.post_date,
            guaranteedDownloads: current.guaranteed_downloads,
            actualDownloads: current.actual_downloads,
            priceType: source.price_type === "flat_rate" ? "flat_rate" : "cpm",
            grossCpm: Number(source.gross_cpm) || 0,
            grossRate: Number(source.gross_rate) || 0,
            netDue: Number(source.net_due) || 0,
          },
          current.kind
        )
      : null;

  const amended = draftAmendedTerms(
    {
      ioNumber: (io as IoRow).io_number?.trim() || current.io_id,
      advertiserName: (io as IoRow).advertiser_name?.trim() || "Advertiser",
      showId: current.show_id,
      line: {
        showName: current.show_name,
        placement: current.placement,
        postDate: current.post_date,
        guaranteedDownloads: current.guaranteed_downloads,
        actualDownloads: current.actual_downloads,
        priceType: source.price_type === "flat_rate" ? "flat_rate" : "cpm",
        grossCpm: Number(source.gross_cpm) || 0,
        grossRate: Number(source.gross_rate) || 0,
        netDue: Number(source.net_due) || 0,
      },
      finding: {
        kind: current.kind,
        reason: current.reason,
        guaranteedDownloads: current.guaranteed_downloads,
        actualDownloads: current.actual_downloads,
        shortfallPct: current.shortfall_pct,
        threshold: current.threshold,
      },
    },
    input.optionId
  );

  let replacementId: string | null = null;
  if (addsSpot) {
    const guaranteed = Number(source.guaranteed_downloads) || current.guaranteed_downloads;
    const { data: created, error: insertError } = await supabaseAdmin
      .from("io_line_items")
      .insert({
        io_id: (io as IoRow).id,
        format: formatOf(source.format),
        post_date: postDate,
        guaranteed_downloads: guaranteed,
        show_name: source.show_name?.trim() || current.show_name,
        placement: placementOf(source.placement || current.placement),
        is_scripted: source.is_scripted === true,
        is_personal_experience: source.is_personal_experience === true,
        reader_type: readerType(source.reader_type),
        content_type: contentType(source.content_type),
        pixel_required: source.pixel_required === true,
        gross_rate: 0,
        gross_cpm: 0,
        price_type: source.price_type === "flat_rate" ? "flat_rate" : "cpm",
        net_due: 0,
        verified: false,
        make_good_triggered: false,
        make_good_reason: null,
        spot_format: source.spot_format ?? null,
      })
      .select("id")
      .single();
    if (insertError || !created) {
      throw new Error(`replacement line insert failed: ${insertError?.message ?? "no row"}`);
    }
    replacementId = (created as { id: string }).id;

    const nextDownloads =
      (Number((io as IoRow).total_downloads) || 0) + guaranteed;
    const { error: totalError } = await supabaseAdmin
      .from("insertion_orders")
      .update({ total_downloads: nextDownloads })
      .eq("id", (io as IoRow).id)
      .eq("deal_id", input.dealId);
    if (totalError) {
      throw new Error(`insertion order total update failed: ${totalError.message}`);
    }
  }

  const deliveryState = addsSpot ? "scheduled" : "credited";
  const decidedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("make_goods")
    .update({
      status: "approved",
      delivery_state: deliveryState,
      selected_option: input.optionId,
      amended_terms: amended,
      credit_amount: credit,
      replacement_line_item_id: replacementId,
      replacement_post_date: addsSpot ? postDate : null,
      decided_by: input.actorId,
      decided_at: decidedAt,
    })
    .eq("id", current.id)
    .eq("deal_id", input.dealId)
    .eq("status", "proposed")
    .select("*")
    .maybeSingle();
  if (updateError) throw new Error(`make-good approval failed: ${updateError.message}`);

  if (!updated) {
    if (replacementId) {
      await supabaseAdmin
        .from("io_line_items")
        .delete()
        .eq("id", replacementId)
        .eq("io_id", (io as IoRow).id);
    }
    return { ok: false, status: 409, error: "This make-good is already decided." };
  }

  const { data: deal, error: dealError } = await supabaseAdmin
    .from("deals")
    .select("id, status")
    .eq("id", input.dealId)
    .maybeSingle();
  if (dealError) throw new Error(`deal lookup failed: ${dealError.message}`);

  let dealStatus: string | null = (deal as { status?: string } | null)?.status ?? null;
  if (addsSpot && dealStatus && DELIVERS_AGAIN.has(dealStatus)) {
    const { error: statusError } = await supabaseAdmin
      .from("deals")
      .update({ status: "delivering" })
      .eq("id", input.dealId)
      .eq("status", dealStatus);
    if (statusError) throw new Error(`deal status update failed: ${statusError.message}`);
    await logEvent({
      eventType: "deal.status_changed",
      entityType: "deal",
      entityId: input.dealId,
      actorId: input.actorId,
      payload: {
        from: dealStatus,
        to: "delivering",
        reason: "make_good_approved",
        make_good_id: current.id,
        show_id: current.show_id,
      },
    });
    dealStatus = "delivering";
  }

  const saved = asMakeGoodRecord(updated);
  if (!saved) throw new Error("make-good approval returned an unreadable row");

  await logEvent({
    eventType: "make_good.approved",
    entityType: "make_good",
    entityId: saved.id,
    actorId: input.actorId,
    payload: {
      deal_id: input.dealId,
      io_id: current.io_id,
      io_line_item_id: current.io_line_item_id,
      show_id: current.show_id,
      kind: current.kind,
      selected_option: input.optionId,
      delivery_state: saved.delivery_state,
      replacement_line_item_id: saved.replacement_line_item_id,
      replacement_post_date: saved.replacement_post_date,
      credit_amount: saved.credit_amount,
      amended_terms: saved.amended_terms,
      deal_status: dealStatus,
    },
  });

  return { ok: true, makeGood: saved, dealStatus };
}

export async function declineMakeGood(input: {
  dealId: string;
  makeGoodId: string;
  actorId: string;
}): Promise<DecideResult> {
  const current = await loadScoped(input.dealId, input.makeGoodId);
  if (!current) {
    return { ok: false, status: 404, error: "Make-good not found on this deal." };
  }
  if (current.status !== "proposed") {
    return { ok: false, status: 409, error: "This make-good is already decided." };
  }

  const decidedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("make_goods")
    .update({
      status: "declined",
      delivery_state: "declined",
      decided_by: input.actorId,
      decided_at: decidedAt,
    })
    .eq("id", current.id)
    .eq("deal_id", input.dealId)
    .eq("status", "proposed")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`make-good decline failed: ${error.message}`);
  if (!data) {
    return { ok: false, status: 409, error: "This make-good is already decided." };
  }
  const saved = asMakeGoodRecord(data);
  if (!saved) throw new Error("make-good decline returned an unreadable row");

  await logEvent({
    eventType: "make_good.declined",
    entityType: "make_good",
    entityId: saved.id,
    actorId: input.actorId,
    payload: {
      deal_id: input.dealId,
      io_id: current.io_id,
      io_line_item_id: current.io_line_item_id,
      show_id: current.show_id,
      kind: current.kind,
      delivery_state: "declined",
    },
  });

  return { ok: true, makeGood: saved, dealStatus: null };
}
