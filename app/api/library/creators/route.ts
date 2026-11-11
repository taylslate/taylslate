// Brand and agency name search over the YouTube library.
// The handler returns the public creator shape only.

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getEffectiveRole } from "@/lib/data/queries";
import { isBrandSide } from "@/lib/nav/items";
import { enforceRules } from "@/lib/security/rate-limit";
import {
  searchLibraryCreators,
  type LibraryCreator,
} from "@/lib/youtube-library/brand-read";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEARCH_MAX = 100;
const MINUTE_SECONDS = 60;
const DAY_SECONDS = 24 * 60 * 60;

function searchTooLong(search: string): boolean {
  if (search.length > SEARCH_MAX * 2) return true;
  const plain = search.replace(/\\([\\%_])/g, "$1");
  return plain.length > SEARCH_MAX;
}

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function toBody(row: LibraryCreator): LibraryCreator {
  return {
    channelId: row.channelId,
    title: row.title,
    thumbnailUrl: row.thumbnailUrl ?? null,
    country: row.country ?? null,
    subscriberCount: row.subscriberCount ?? null,
    videoCount: row.videoCount ?? null,
    averageViews: row.averageViews ?? null,
    averageViewsLabel: row.averageViewsLabel === "recent" ? "recent" : "average",
    nicheTags: Array.isArray(row.nicheTags)
      ? row.nicheTags.filter((tag): tag is string => typeof tag === "string")
      : [],
    youtubeUrl: `https://www.youtube.com/channel/${row.channelId}`,
  };
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const eff = await getEffectiveRole(user.id);
  if (!eff || !isBrandSide(eff.effectiveRole)) return json({ error: "Forbidden" }, 403);

  const search = request.nextUrl.searchParams.get("search") ?? "";
  if (searchTooLong(search)) return json({ error: "Search is too long." }, 400);

  const limited = await enforceRules({
    failureMode: "closed",
    rules: [
      {
        bucket: "library_creators_user_minute",
        key: user.id,
        max: 30,
        windowSeconds: MINUTE_SECONDS,
      },
      {
        bucket: "library_creators_user_day",
        key: user.id,
        max: 1000,
        windowSeconds: DAY_SECONDS,
      },
    ],
  });
  if (limited) {
    limited.headers.set("Cache-Control", "no-store");
    return limited;
  }

  try {
    const creators = await searchLibraryCreators({ query: search });
    return json(creators.map(toBody));
  } catch {
    return json({ error: "Could not load creators." }, 500);
  }
}
