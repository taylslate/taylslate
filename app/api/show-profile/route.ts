import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUser,
  ensureProfile,
  getShowProfileByUserId,
  upsertShowProfile,
} from "@/lib/data/queries";
import type {
  ShowAdFormat,
  ShowAdReadType,
  ShowCategoryExclusion,
  ShowEpisodeCadence,
  ShowPlacement,
  ShowProfile,
  ShowProfilePlatform,
} from "@/lib/data/types";

const ALLOWED_PLATFORMS: ShowProfilePlatform[] = ["podcast", "youtube", "both"];
const ALLOWED_CADENCES: ShowEpisodeCadence[] = [
  "daily",
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

  for (const k of [
    "feed_url",
    "podscan_id",
    "show_name",
    "show_description",
    "show_image_url",
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

  for (const k of ["episode_count", "audience_size", "expected_cpm"] as const) {
    if (typeof body[k] === "number" && Number.isFinite(body[k] as number)) {
      patch[k] = Math.max(0, Math.round(body[k] as number));
    }
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
  return NextResponse.json({ show_profile: showProfile });
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

  const patch = sanitizeShowProfilePatch(body);
  const result = await upsertShowProfile(user.id, patch);
  if (!result) {
    return NextResponse.json({ error: "Failed to save show profile" }, { status: 500 });
  }

  return NextResponse.json({ show_profile: result });
}
