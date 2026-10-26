import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedUser, getUserProfile } from "@/lib/data/queries";
import {
  buildRecordInserts,
  matchPastCampaignShows,
  parseSaveBody,
  PastCampaignImportError,
  type ShowMatchCandidate,
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
    // The session user is the only caller. A brand_id in the body is ignored.
    // past_campaign_show_candidates is login-only (migration 068) and already
    // drops hidden shows this caller did not create. The decision below
    // applies that rule again. A failed lookup saves the row unmatched.
    const matches = await matchPastCampaignShows(
      parsed.drafts.map((draft) => draft.show_name),
      user.id,
      async (matchKey) => {
        const { data, error } = await supabase.rpc("past_campaign_show_candidates", {
          match_key: matchKey,
        });
        if (error || !Array.isArray(data)) return [];
        return data as ShowMatchCandidate[];
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
    const recordRows = buildRecordInserts(importId, user.id, parsed.drafts, matches);
    const recorded = await supabase
      .from("past_campaign_records")
      .insert(recordRows)
      .select(
        "id, import_id, brand_id, show_name, matched_show_id, show_match_status, show_match_reason, show_match_confidence, flight_start, flight_end, placement, price_type, rate, episodes, spend, conversions, downloads, raw"
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
