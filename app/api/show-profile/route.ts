import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  ensureProfile,
  getShowProfileByUserId,
  upsertShowProfile,
  generateSlug,
} from "@/lib/data/queries";
import type {
  ShowAdFormat,
  ShowAdReadType,
  ShowBrandHistoryEntry,
  ShowCategoryExclusion,
  ShowEpisodeCadence,
  ShowPlacement,
  ShowProfile,
  ShowProfilePlatform,
} from "@/lib/data/types";
import { parseMediaKitGeography, hasAudienceGeography } from "@/lib/shows/media-kit-geo";
import { applyAudienceGeographyToShow } from "@/lib/shows/apply-geography";
import { SHOW_PROFILE_PODSCAN_ID_LABEL } from "@/lib/shows/profile-podscan";

const ALLOWED_PLATFORMS: ShowProfilePlatform[] = ["podcast", "youtube", "both"];
const ALLOWED_CADENCES: ShowEpisodeCadence[] = [
  "daily",
  "multiple_weekly",
  "weekly",
  "biweekly",
  "monthly",
  "irregular",
];
const ALLOWED_FORMATS: ShowAdFormat[] = ["host_read_baked", "dynamic_insertion"];
const ALLOWED_READ_TYPES: ShowAdReadType[] = [
  "personal_experience",
  "scripted",
  "talking_points",
  "any",
];
const ALLOWED_PLACEMENTS: ShowPlacement[] = ["pre_roll", "mid_roll", "post_roll"];
const ALLOWED_EXCLUSIONS: ShowCategoryExclusion[] = [
  "gambling",
  "alcohol",
  "supplements",
  "political",
  "crypto",
  "adult",
  "none",
];

// brand_history (Wave 14 Phase 2D Layer 2). Self-reported advertiser history,
// stored as JSONB. Bounds keep a user-controlled write from bloating the column.
const ALLOWED_DEAL_TYPES = ["one-off", "annual"] as const;
const BRAND_HISTORY_MAX_ENTRIES = 10; // backstop; onboarding UI soft-limits to 5
const BRAND_NAME_MAX = 100;
const BRAND_CATEGORY_MAX = 80;
const BRAND_NOTES_MAX = 500;
const MEDIA_KIT_MAX = 20_000;

/**
 * Validate a single brand_history element into a fresh, key-whitelisted object.
 * Returns null when the entry has no usable brand_name (caller skips it). Only
 * the four known keys are ever copied — arbitrary caller keys never reach JSONB.
 */
function sanitizeBrandHistoryEntry(raw: unknown): ShowBrandHistoryEntry | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;

  const brandName = typeof entry.brand_name === "string" ? entry.brand_name.trim() : "";
  if (!brandName) return null;

  const clean: ShowBrandHistoryEntry = { brand_name: brandName.slice(0, BRAND_NAME_MAX) };

  if (typeof entry.category === "string") {
    const category = entry.category.trim();
    if (category) clean.category = category.slice(0, BRAND_CATEGORY_MAX);
  }
  if (typeof entry.notes === "string") {
    const notes = entry.notes.trim();
    if (notes) clean.notes = notes.slice(0, BRAND_NOTES_MAX);
  }
  if (
    typeof entry.deal_type === "string" &&
    (ALLOWED_DEAL_TYPES as readonly string[]).includes(entry.deal_type)
  ) {
    clean.deal_type = entry.deal_type as ShowBrandHistoryEntry["deal_type"];
  }

  return clean;
}

function dedupeEnum<T extends string>(input: unknown, allowed: readonly T[], cap = 8): T[] {
  if (!Array.isArray(input)) return [];
  const allowedSet = new Set<string>(allowed);
  const seen = new Set<T>();
  const out: T[] = [];
  for (const v of input) {
    if (typeof v !== "string") continue;
    if (!allowedSet.has(v)) continue;
    if (seen.has(v as T)) continue;
    seen.add(v as T);
    out.push(v as T);
    if (out.length >= cap) break;
  }
  return out;
}

/** Whitelist and sanitize the PATCH body so only known fields ever hit the DB. */
export function sanitizeShowProfilePatch(
  body: Record<string, unknown>
): Partial<Omit<ShowProfile, "id" | "user_id" | "created_at" | "updated_at" | "onboarded_at">> {
  const patch: Partial<ShowProfile> = {};

  // podscan_id is self-reported. The route does not copy it from the
  // body. A catalog tie is a deal or a show_owner email match.
  for (const k of [
    "feed_url",
    "show_name",
    "show_description",
    "show_image_url",
    "ad_copy_email",
    "billing_email",
  ] as const) {
    if (typeof body[k] === "string") {
      const trimmed = (body[k] as string).trim();
      patch[k] = trimmed || null;
    }
  }

  if (Array.isArray(body.show_categories)) {
    patch.show_categories = body.show_categories
      .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
      .slice(0, 10);
  }

  for (const k of ["episode_count", "audience_size"] as const) {
    if (typeof body[k] === "number" && Number.isFinite(body[k] as number)) {
      patch[k] = Math.max(0, Math.round(body[k] as number));
    }
  }

  // expected_cpm accepts two decimal places ($28.50) — stored as NUMERIC(6,2)
  // after migration 010. Round to cents to normalize DB writes.
  if (typeof body.expected_cpm === "number" && Number.isFinite(body.expected_cpm)) {
    patch.expected_cpm = Math.max(0, Math.round(body.expected_cpm * 100) / 100);
  }

  if (typeof body.platform === "string" && ALLOWED_PLATFORMS.includes(body.platform as ShowProfilePlatform)) {
    patch.platform = body.platform as ShowProfilePlatform;
  }

  if (typeof body.episode_cadence === "string" && ALLOWED_CADENCES.includes(body.episode_cadence as ShowEpisodeCadence)) {
    patch.episode_cadence = body.episode_cadence as ShowEpisodeCadence;
  }

  if (body.ad_formats !== undefined) patch.ad_formats = dedupeEnum(body.ad_formats, ALLOWED_FORMATS);
  if (body.ad_read_types !== undefined) patch.ad_read_types = dedupeEnum(body.ad_read_types, ALLOWED_READ_TYPES);
  if (body.placements !== undefined) patch.placements = dedupeEnum(body.placements, ALLOWED_PLACEMENTS);
  if (body.category_exclusions !== undefined) {
    patch.category_exclusions = dedupeEnum(body.category_exclusions, ALLOWED_EXCLUSIONS);
  }

  // brand_history: only touch the patch when an array is sent (mirrors show_categories).
  // Each entry is rebuilt key-by-key by sanitizeBrandHistoryEntry, blank-brand entries
  // are dropped, and the list is capped — so malformed/oversized input can't write junk.
  if (Array.isArray(body.brand_history)) {
    const cleaned: ShowBrandHistoryEntry[] = [];
    for (const raw of body.brand_history) {
      const entry = sanitizeBrandHistoryEntry(raw);
      if (entry) cleaned.push(entry);
      if (cleaned.length >= BRAND_HISTORY_MAX_ENTRIES) break;
    }
    patch.brand_history = cleaned;
  }

  // Geography is parsed here from the kit text. A client-supplied
  // audience_geography object is ignored so the stored shares match
  // the text. Empty text clears both.
  if (typeof body.media_kit_text === "string") {
    const text = body.media_kit_text.trim().slice(0, MEDIA_KIT_MAX);
    patch.media_kit_text = text || null;
    const geography = parseMediaKitGeography(text);
    patch.audience_geography = hasAudienceGeography(geography) ? geography : null;
  }

  return patch;
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await ensureProfile({ id: user.id, email: user.email ?? undefined });
  } catch (err) {
    console.error("[show-profile/GET] ensureProfile failed:", err);
    return NextResponse.json({ error: "Failed to initialize profile" }, { status: 500 });
  }

  const showProfile = await getShowProfileByUserId(user.id);
  return NextResponse.json({
    show_profile: showProfile,
    podscan_id_label: SHOW_PROFILE_PODSCAN_ID_LABEL,
  });
}

export async function PUT(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    await ensureProfile({ id: user.id, email: user.email ?? undefined });
  } catch (err) {
    console.error("[show-profile/PUT] ensureProfile failed:", err);
    return NextResponse.json({ error: "Failed to initialize profile" }, { status: 500 });
  }

  const existing = await getShowProfileByUserId(user.id);
  const patch = sanitizeShowProfilePatch(body);
  // show_slug is a migration-045 column, display-only. Write it only
  // with the kit so the rest of onboarding keeps saving if that
  // migration is not applied yet. It is not a catalog tie.
  if ("media_kit_text" in patch) {
    const nameForSlug =
      patch.show_name !== undefined ? patch.show_name : existing?.show_name ?? null;
    if (typeof nameForSlug === "string" && nameForSlug.trim()) {
      patch.show_slug = generateSlug(nameForSlug);
    }
  }

  const result = await upsertShowProfile(user.id, patch);
  if (!result) {
    return NextResponse.json({ error: "Failed to save show profile" }, { status: 500 });
  }

  // Copy parsed country shares onto a shows row only when a verified
  // tie exists (a deal, or a show_owner email). A stored podscan id is
  // not a tie. A miss is fine — the profile still holds the parse.
  // Failures here must not fail the save.
  if ("media_kit_text" in patch) {
    await applyAudienceGeographyToShow(result);
  }

  return NextResponse.json({ show_profile: result });
}
