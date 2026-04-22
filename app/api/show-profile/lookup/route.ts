import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { getPodscanClientSafe } from "@/lib/podscan";
import { lookupShowByUrl } from "@/lib/podscan/lookup";
import type { PodscanPodcast } from "@/lib/podscan/types";
import { stripHtml } from "@/lib/utils/strip-html";

/**
 * Given a raw feed URL or Apple Podcasts link, look the show up in Podscan
 * and return a flat subset of fields the onboarding UI needs. Returns
 * `{ found: false }` when the feed isn't in Podscan yet (shows still
 * complete onboarding manually in that case).
 *
 * Failure modes — Podscan down, rate limited, missing API key — all degrade
 * gracefully to `{ found: false }` with the real error logged server-side.
 * Onboarding should never be blocked by a lookup failure.
 */
function flattenCategories(p: PodscanPodcast): string[] {
  const out: string[] = [];
  for (const c of p.podcast_categories ?? []) {
    if (typeof c === "string") out.push(c);
    else if (c && typeof c === "object" && "category_name" in c) out.push(c.category_name);
  }
  return out.slice(0, 10);
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { url?: string };
  try {
    body = (await request.json()) as { url?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const url = body.url?.trim();
  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  const client = getPodscanClientSafe();
  if (!client) {
    console.warn("[show-profile/lookup] Podscan client unavailable, returning found:false");
    return NextResponse.json({ found: false });
  }

  try {
    const podcast = await lookupShowByUrl(client, url);
    if (!podcast) {
      return NextResponse.json({ found: false });
    }
    return NextResponse.json({
      found: true,
      podcast: {
        podscan_id: podcast.podcast_id,
        show_name: podcast.podcast_name,
        show_description: stripHtml(podcast.podcast_description) || null,
        show_image_url: podcast.podcast_image_url ?? null,
        show_categories: flattenCategories(podcast),
        episode_count: podcast.episode_count ?? null,
        audience_size: podcast.reach?.audience_size ?? null,
      },
    });
  } catch (err) {
    console.error(
      "[show-profile/lookup] Podscan lookup failed, returning found:false:",
      err instanceof Error ? `${err.name}: ${err.message}` : err
    );
    return NextResponse.json({ found: false });
  }
}
