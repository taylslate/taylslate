import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getIOByDealId, getDealById, getNextIONumber } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { persistIoForDeal } from "@/lib/io/persist-io";
import type { IoLineItemDraft } from "@/lib/pdf/io-generator";
import type { Deal } from "@/lib/data/types";
import { parseShowSurfaceId } from "@/lib/shows/surfaces";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const IO_FIELDS = [
  "advertiser_name",
  "advertiser_contact_name",
  "advertiser_contact_email",
  "publisher_name",
  "publisher_contact_name",
  "publisher_contact_email",
  "publisher_address",
  "agency_name",
  "agency_contact_name",
  "agency_contact_email",
  "agency_billing_contact",
  "agency_address",
  "send_invoices_to",
  "payment_terms",
  "payment_off_platform",
  "competitor_exclusion",
  "exclusivity_days",
  "rofr_days",
  "rofr_enabled",
  "cancellation_notice_days",
  "download_tracking_days",
  "download_tracking_enabled",
  "make_good_threshold",
  "make_good_enabled",
  "payer",
] as const;

const LINE_FIELDS = [
  "format",
  "spot_format",
  "show_surface_id",
  "post_date",
  "guaranteed_downloads",
  "show_name",
  "placement",
  "is_scripted",
  "is_personal_experience",
  "reader_type",
  "content_type",
  "pixel_required",
  "gross_rate",
  "gross_cpm",
  "price_type",
  "net_due",
  "actual_post_date",
  "actual_downloads",
  "episode_url",
  "ad_timestamp",
  "verified",
  "make_good_triggered",
  "make_good_reason",
] as const;

const LINE_NUMBERS = new Set([
  "guaranteed_downloads",
  "gross_rate",
  "gross_cpm",
  "net_due",
  "actual_downloads",
]);

const IO_BOOLS = [
  "payment_off_platform",
  "rofr_enabled",
  "make_good_enabled",
  "download_tracking_enabled",
] as const;

function isParty(deal: Deal, userId: string): boolean {
  return deal.agent_id === userId || deal.brand_id === userId || deal.agency_id === userId;
}

function docusignLocked(deal: Deal): boolean {
  return Boolean((deal as { docusign_envelope_id?: string | null }).docusign_envelope_id);
}

function pickFields(
  source: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

function lineFields(source: Record<string, unknown>): Record<string, unknown> {
  const fields = pickFields(source, LINE_FIELDS);
  for (const key of LINE_NUMBERS) {
    if (fields[key] !== undefined && fields[key] !== null && fields[key] !== "") {
      const n = Number(fields[key]);
      if (Number.isFinite(n)) fields[key] = n;
    }
  }
  if (fields.spot_format !== undefined) {
    const raw = typeof fields.spot_format === "string" ? fields.spot_format.trim() : "";
    fields.spot_format = raw || null;
  }
  if (fields.show_surface_id !== undefined) {
    fields.show_surface_id = parseShowSurfaceId(fields.show_surface_id);
  }
  return fields;
}

/** Allowlisted header fields, with the new flags checked before they hit the DB. */
function headerFields(
  source: Record<string, unknown>
): { fields: Record<string, unknown> } | { error: string } {
  const fields = pickFields(source, IO_FIELDS);
  for (const key of IO_BOOLS) {
    if (fields[key] !== undefined && typeof fields[key] !== "boolean") {
      return { error: `${key} must be true or false` };
    }
  }
  if (fields.payer !== undefined && fields.payer !== "brand" && fields.payer !== "agency") {
    return { error: "payer must be brand or agency" };
  }
  return { fields };
}

async function loadDealForParty(dealId: string, userId: string) {
  const deal = await getDealById(dealId);
  if (!deal) {
    return { error: NextResponse.json({ error: "Deal not found" }, { status: 404 }) };
  }
  if (!isParty(deal, userId)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (docusignLocked(deal)) {
    return {
      error: NextResponse.json(
        {
          error:
            "This IO was sent for signature via DocuSign and can't be edited here.",
        },
        { status: 409 }
      ),
    };
  }
  return { deal };
}

// GET: Fetch IO for a deal
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: dealId } = await params;
    const io = await getIOByDealId(dealId);

    if (!io) {
      return NextResponse.json({ error: "No IO found for this deal" }, { status: 404 });
    }

    return NextResponse.json({ io });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to fetch IO: ${message}` }, { status: 500 });
  }
}

// POST: Create the IO for a deal that doesn't have one yet. The editor calls
// this; sending for signature is a different route.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: dealId } = await params;
    const loaded = await loadDealForParty(dealId, user.id);
    if (loaded.error) return loaded.error;

    const existing = await getIOByDealId(dealId);
    if (existing) {
      return NextResponse.json(
        { error: "An IO already exists for this deal", io: existing },
        { status: 409 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const header = headerFields(body);
    if ("error" in header) {
      return NextResponse.json({ error: header.error }, { status: 400 });
    }

    const advertiserName = typeof body.advertiser_name === "string" ? body.advertiser_name.trim() : "";
    const publisherName = typeof body.publisher_name === "string" ? body.publisher_name.trim() : "";
    if (!advertiserName) {
      return NextResponse.json({ error: "Advertiser name is required" }, { status: 400 });
    }
    if (!publisherName) {
      return NextResponse.json({ error: "Publisher name is required" }, { status: 400 });
    }

    const rawItems = Array.isArray(body.line_items) ? body.line_items : [];
    if (rawItems.length === 0) {
      return NextResponse.json({ error: "At least one line item is required" }, { status: 400 });
    }

    const drafts: IoLineItemDraft[] = [];
    for (let i = 0; i < rawItems.length; i++) {
      const raw = rawItems[i] as Record<string, unknown>;
      const fields = lineFields(raw);
      const postDate = typeof fields.post_date === "string" ? fields.post_date : "";
      const gross = Number(fields.gross_rate);
      if (!postDate) {
        return NextResponse.json(
          { error: `Line item ${i + 1} is missing a post date` },
          { status: 400 }
        );
      }
      if (!(gross > 0)) {
        return NextResponse.json(
          { error: `Line item ${i + 1} needs a gross rate above zero` },
          { status: 400 }
        );
      }
      drafts.push({
        format: fields.format === "youtube" ? "youtube" : "podcast",
        post_date: postDate,
        guaranteed_downloads: Number(fields.guaranteed_downloads) || 0,
        show_name: typeof fields.show_name === "string" && fields.show_name ? fields.show_name : publisherName,
        placement: (fields.placement as IoLineItemDraft["placement"]) || "mid-roll",
        is_scripted: fields.is_scripted === true,
        is_personal_experience: fields.is_personal_experience !== false,
        reader_type: (fields.reader_type as IoLineItemDraft["reader_type"]) || "host_read",
        content_type: (fields.content_type as IoLineItemDraft["content_type"]) || "evergreen",
        pixel_required: fields.pixel_required === true,
        gross_rate: gross,
        gross_cpm: Number(fields.gross_cpm) || 0,
        price_type: fields.price_type === "flat_rate" ? "flat_rate" : "cpm",
        net_due: Number(fields.net_due) > 0 ? Number(fields.net_due) : gross,
        verified: false,
        make_good_triggered: false,
        spot_format: typeof fields.spot_format === "string" ? fields.spot_format : null,
        ...(typeof fields.show_surface_id === "string"
          ? { show_surface_id: fields.show_surface_id }
          : {}),
      });
    }

    const totalDownloads = drafts.reduce((sum, item) => sum + item.guaranteed_downloads, 0);
    const totalGross = Math.round(drafts.reduce((sum, item) => sum + item.gross_rate, 0) * 100) / 100;
    const totalNet = Math.round(drafts.reduce((sum, item) => sum + item.net_due, 0) * 100) / 100;
    const ioNumber = await getNextIONumber();

    const result = await persistIoForDeal({
      dealId,
      rendered: { ioNumber, totalGross, totalNet, totalDownloads, lineItems: drafts },
      contacts: {
        advertiserName,
        advertiserContactEmail:
          typeof body.advertiser_contact_email === "string" ? body.advertiser_contact_email : null,
        publisherName,
        publisherContactName:
          typeof body.publisher_contact_name === "string" ? body.publisher_contact_name : "",
        publisherContactEmail:
          typeof body.publisher_contact_email === "string" ? body.publisher_contact_email : "",
      },
      actorId: user.id,
      source: "io_editor",
      overrides: { status: "draft" },
    });

    if (result.created) {
      const { error: headerError } = await supabaseAdmin
        .from("insertion_orders")
        .update({
          ...header.fields,
          advertiser_name: advertiserName,
          publisher_name: publisherName,
          status: "draft",
          sent_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", result.ioId);
      if (headerError) {
        return NextResponse.json(
          { error: `Failed to save IO details: ${headerError.message}` },
          { status: 500 }
        );
      }
    }

    const io = await getIOByDealId(dealId);
    return NextResponse.json({ io }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.startsWith("Refusing to persist") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

// PATCH: Update IO fields (party details, terms, line items)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: dealId } = await params;
    const loaded = await loadDealForParty(dealId, user.id);
    if (loaded.error) return loaded.error;

    const io = await getIOByDealId(dealId);
    if (!io) {
      return NextResponse.json({ error: "No IO found for this deal" }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const header = headerFields(body);
    if ("error" in header) {
      return NextResponse.json({ error: header.error }, { status: 400 });
    }

    const supabase = await createClient();
    const lineItemUpdates = Array.isArray(body.line_items) ? body.line_items : null;
    const syncLineItems = body.sync_line_items === true;
    const ioUpdates = header.fields;

    if (Object.keys(ioUpdates).length > 0) {
      const { error: ioError } = await supabase
        .from("insertion_orders")
        .update({ ...ioUpdates, updated_at: new Date().toISOString() })
        .eq("id", io.id);

      if (ioError) {
        return NextResponse.json(
          { error: `Failed to update IO: ${ioError.message}` },
          { status: 500 }
        );
      }
    }

    if (lineItemUpdates) {
      const keepIds: string[] = [];
      const toInsert: Record<string, unknown>[] = [];

      for (const raw of lineItemUpdates) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as Record<string, unknown>;
        const fields = lineFields(item);
        if (UUID_RE.test(String(item.id ?? ""))) {
          const liId = String(item.id);
          if (Object.keys(fields).length === 0) {
            keepIds.push(liId);
            continue;
          }
          const { error: liError } = await supabase
            .from("io_line_items")
            .update(fields)
            .eq("id", liId)
            .eq("io_id", io.id);

          if (liError) {
            return NextResponse.json(
              { error: `Failed to update line item ${liId}: ${liError.message}` },
              { status: 500 }
            );
          }
          keepIds.push(liId);
        } else if (syncLineItems) {
          toInsert.push({ ...fields, io_id: io.id, verified: fields.verified === true, make_good_triggered: fields.make_good_triggered === true });
        }
      }

      if (toInsert.length > 0) {
        const { data: inserted, error: insertError } = await supabase
          .from("io_line_items")
          .insert(toInsert)
          .select("id");
        if (insertError) {
          return NextResponse.json(
            { error: `Failed to add line items: ${insertError.message}` },
            { status: 500 }
          );
        }
        for (const row of inserted ?? []) keepIds.push(row.id as string);
      }

      // The editor sends the full set. Delivery updates send one item and must
      // not delete the rest. There is no DELETE policy for the user role, so
      // the party-checked admin client removes the omitted rows.
      if (syncLineItems) {
        if (keepIds.length === 0) {
          return NextResponse.json(
            { error: "At least one line item is required" },
            { status: 400 }
          );
        }
        const { error: deleteError } = await supabaseAdmin
          .from("io_line_items")
          .delete()
          .eq("io_id", io.id)
          .not("id", "in", `(${keepIds.join(",")})`);
        if (deleteError) {
          return NextResponse.json(
            { error: `Failed to remove line items: ${deleteError.message}` },
            { status: 500 }
          );
        }
      }

      const { data: updatedItems } = await supabase
        .from("io_line_items")
        .select("guaranteed_downloads, gross_rate, net_due")
        .eq("io_id", io.id);

      if (updatedItems) {
        const totalDownloads = updatedItems.reduce(
          (s, li) => s + Number(li.guaranteed_downloads),
          0
        );
        const totalGross = updatedItems.reduce((s, li) => s + Number(li.gross_rate), 0);
        const totalNet = updatedItems.reduce((s, li) => s + Number(li.net_due), 0);

        await supabase
          .from("insertion_orders")
          .update({
            total_downloads: totalDownloads,
            total_gross: Math.round(totalGross * 100) / 100,
            total_net: Math.round(totalNet * 100) / 100,
            updated_at: new Date().toISOString(),
          })
          .eq("id", io.id);
      }
    }

    const updatedIO = await getIOByDealId(dealId);
    return NextResponse.json({ io: updatedIO });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to update IO: ${message}` }, { status: 500 });
  }
}
