import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getCampaignById, updateCampaignSelections } from "@/lib/data/queries";
import { pitchableShowIds } from "@/lib/relay/recipient";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IDS = 200;
const MAX_ID_LENGTH = 200;

function invalidSelection() {
  return NextResponse.json({ error: "Invalid selection" }, { status: 400 });
}

function showNotFound() {
  return NextResponse.json({ error: "Show not found" }, { status: 400 });
}

export async function PUT(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { campaign_id?: unknown; selected_show_ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.campaign_id) {
    return NextResponse.json({ error: "campaign_id required" }, { status: 400 });
  }
  if (typeof body.campaign_id !== "string") {
    return NextResponse.json({ error: "campaign_id required" }, { status: 400 });
  }

  const raw = body.selected_show_ids;
  if (!Array.isArray(raw) || raw.length > MAX_IDS) return invalidSelection();
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" || item.length < 1 || item.length > MAX_ID_LENGTH) {
      return invalidSelection();
    }
    if (seen.has(item)) continue;
    seen.add(item);
    ids.push(item);
  }

  let campaign: Awaited<ReturnType<typeof getCampaignById>>;
  try {
    campaign = await getCampaignById(body.campaign_id);
  } catch {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign?.user_id !== user.id) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const scored = new Set<string>();
  for (const row of campaign.scored_shows ?? []) {
    if (row && typeof row.podcastId === "string" && row.podcastId.length > 0) {
      scored.add(row.podcastId);
    }
  }

  let pitchable: Set<string>;
  try {
    pitchable = await pitchableShowIds(user.id, ids);
  } catch {
    return showNotFound();
  }
  for (const id of ids) {
    if (UUID.test(id)) {
      if (!pitchable.has(id)) return showNotFound();
    } else if (!scored.has(id)) {
      return showNotFound();
    }
  }

  const success = await updateCampaignSelections(body.campaign_id, ids);

  if (!success) {
    return NextResponse.json({ error: "Failed to update selections" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
