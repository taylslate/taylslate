import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedUser, getUserProfile } from "@/lib/data/queries";
import {
  buildRecordInserts,
  lookupShowHints,
  parseSaveBody,
  PastCampaignImportError,
} from "@/lib/imports/past-campaigns";

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await getUserProfile(user.id);
    if (!profile || (profile.role !== "brand" && profile.role !== "agency")) {
      return NextResponse.json(
        { error: "Only brand and agency accounts can save past campaigns" },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = parseSaveBody(body);
    const supabase = await createClient();
    const showIds = await lookupShowHints(
      parsed.drafts.map((draft) => draft.show_name),
      async (name) => {
        const { data, error } = await supabase
          .from("shows")
          .select("id, name")
          .ilike("name", name)
          .limit(2);
        if (error || !data) return [];
        return data as { id: string; name: string }[];
      }
    );

    const importRow = {
      brand_id: user.id,
      source_kind: parsed.source_kind,
      file_name: parsed.file_name,
      status: "confirmed",
      pooling_consent: parsed.pooling_consent,
      terms_version: parsed.terms_version,
    };

    const inserted = await supabase
      .from("past_campaign_imports")
      .insert(importRow)
      .select("id, brand_id, source_kind, file_name, status, pooling_consent, terms_version")
      .single();

    if (inserted.error || !inserted.data?.id) {
      return NextResponse.json({ error: "Could not save this import" }, { status: 500 });
    }

    const importId = inserted.data.id as string;
    const recordRows = buildRecordInserts(importId, user.id, parsed.drafts, showIds);
    const recorded = await supabase
      .from("past_campaign_records")
      .insert(recordRows)
      .select(
        "id, import_id, brand_id, show_name, matched_show_id, flight_start, flight_end, placement, price_type, rate, episodes, spend, conversions, downloads, raw"
      );

    if (recorded.error || !Array.isArray(recorded.data) || recorded.data.length !== recordRows.length) {
      await supabase
        .from("past_campaign_imports")
        .delete()
        .eq("id", importId)
        .eq("brand_id", user.id);
      return NextResponse.json({ error: "Could not save campaign rows" }, { status: 500 });
    }

    return NextResponse.json(
      { import: inserted.data, records: recorded.data },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof PastCampaignImportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Past campaign save failed", err);
    return NextResponse.json({ error: "Could not save this import" }, { status: 500 });
  }
}
