import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { importShows, getUserProfile } from "@/lib/data/queries";
import { isShowsAdmin } from "@/lib/shows/can-edit-show";
import type { AudienceGeography, ShowDemographics } from "@/lib/data/types";
import {
  GEO_KEYS,
  hasAudienceGeography,
  parseMediaKitGeography,
} from "@/lib/shows/media-kit-geo";
import { enforceUpload } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await getUserProfile(user.id);
    const role = profile?.role as string | undefined;
    if (!(await isShowsAdmin(user.id)) && role !== "agent") {
      return NextResponse.json({ error: "Only agents can import shows" }, { status: 403 });
    }

    const limited = await enforceUpload(request, user.id);
    if (limited) return limited;

    const contentType = request.headers.get("content-type") || "";
    let shows: Array<Partial<import("@/lib/data/types").Show> & { name: string; platform: "podcast" | "youtube" }>;

    if (contentType.includes("multipart/form-data")) {
      // Handle file upload
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      const text = await file.text();
      shows = parseCSVToShows(text) as typeof shows;
    } else {
      // Handle JSON body with pre-parsed shows
      const body = await request.json();
      shows = body.shows;
      if (!Array.isArray(shows)) {
        return NextResponse.json({ error: "shows array is required" }, { status: 400 });
      }
    }

    if (shows.length === 0) {
      return NextResponse.json({ error: "No valid shows found in file" }, { status: 400 });
    }

    // importShows reads the agent from the session. A body agent id is ignored.
    const result = await importShows(shows);

    return NextResponse.json({
      imported: result.imported.length,
      skipped: result.skipped.length,
      errors: result.errors.length,
      shows: result.imported,
      skipped_names: result.skipped,
      error_messages: result.errors,
    });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: "Failed to import shows" },
      { status: 500 }
    );
  }
}

export function parseCSVToShows(text: string) {
  const rows = text.split(/\r?\n/).filter(r => r.trim());
  if (rows.length < 2) return [];

  const header = rows[0].toLowerCase();
  const results: Array<{
    name: string;
    platform: "podcast" | "youtube";
    audience_size?: number;
    rate_card?: Record<string, number>;
    categories?: string[];
    description?: string;
    price_type?: "cpm" | "flat_rate";
    episode_cadence?: string;
    ad_formats?: string[];
    demographics?: ShowDemographics;
  }> = [];

  for (let i = 1; i < rows.length; i++) {
    const cols = parseCSVLine(rows[i]);
    const headerCols = parseCSVLine(rows[0]);

    const get = (names: string[]): string => {
      for (const name of names) {
        const idx = headerCols.findIndex(h =>
          h.toLowerCase().trim().includes(name.toLowerCase())
        );
        if (idx >= 0 && cols[idx]) return cols[idx].trim();
      }
      return "";
    };

    const name = get(["show name", "name", "channel", "podcast", "show"]);
    if (!name) continue;

    const platformRaw = get(["platform", "channel type", "type", "medium"]).toLowerCase();
    const isYouTube = platformRaw.includes("youtube") || platformRaw.includes("yt") ||
      get(["youtube", "channel url", "channel id"]).length > 0;
    const platform = isYouTube ? "youtube" as const : "podcast" as const;

    const downloads = parseNum(get(["downloads", "audience", "listeners", "views", "avg views"]));
    const cpm = parseNum(get(["cpm", "rate", "cost"]));
    const flatRate = parseNum(get(["flat rate", "price per spot", "price", "spot rate"]));
    const category = get(["category", "genre", "niche"]);
    const kit = get(["media kit", "audience geography", "geography"]);
    const geography: AudienceGeography = {
      ...parseMediaKitGeography(kit),
      ...explicitCountryShares(headerCols, cols),
    };

    const rate_card: Record<string, number> = {};
    if (platform === "youtube" && flatRate > 0) {
      rate_card.flat_rate = flatRate;
    } else if (cpm > 0) {
      rate_card.midroll_cpm = cpm;
    }
    if (flatRate > 0 && platform === "podcast") {
      rate_card.flat_rate = flatRate;
    }

    results.push({
      name,
      platform,
      audience_size: downloads || undefined,
      rate_card: Object.keys(rate_card).length > 0 ? rate_card : undefined,
      categories: category ? [category] : undefined,
      price_type: platform === "youtube" ? "flat_rate" : "cpm",
      episode_cadence: "weekly",
      ad_formats: platform === "podcast" ? ["host_read"] : ["integration"],
      demographics: hasAudienceGeography(geography) ? geography : undefined,
    });
  }

  return results;
}

function parseCSVLine(line: string): string[] {
  const cols: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { cols.push(current); current = ""; }
      else { current += ch; }
    }
  }
  cols.push(current);
  return cols;
}

const COUNTRY_HEADERS: Record<string, (typeof GEO_KEYS)[number]> = {
  us: "us",
  "us %": "us",
  usa: "us",
  "united states": "us",
  uk: "uk",
  "uk %": "uk",
  "united kingdom": "uk",
  canada: "canada",
  "canada %": "canada",
  australia: "australia",
  "australia %": "australia",
};

/** Exact header match so a column named "audience" is not read as "us". */
function explicitCountryShares(headerCols: string[], cols: string[]): AudienceGeography {
  const geo: AudienceGeography = {};
  headerCols.forEach((header, idx) => {
    const key = COUNTRY_HEADERS[header.toLowerCase().trim()];
    if (!key) return;
    const n = parseNum(cols[idx] ?? "");
    if (n > 0 && n <= 100) geo[key] = n;
  });
  return geo;
}

function parseNum(str: string): number {
  if (!str) return 0;
  return parseFloat(str.replace(/[$,\s%]/g, "")) || 0;
}
