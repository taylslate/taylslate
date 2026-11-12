// YouTube ownership check. One channels.list call through the
// existing client. No key and any API error are unavailable, not a miss.
// A connected OAuth channel is not proof.

import { getYouTubeClientSafe } from "@/lib/enrichment/youtube";

export type YoutubeProofRead =
  | { status: "ok"; description: string }
  | { status: "unavailable" };

export async function readYoutubeDescription(channelId: string): Promise<YoutubeProofRead> {
  const client = getYouTubeClientSafe();
  if (!client) return { status: "unavailable" };
  try {
    const details = await client.getChannelDetails(channelId);
    if (!details) return { status: "ok", description: "" };
    return { status: "ok", description: details.description ?? "" };
  } catch {
    return { status: "unavailable" };
  }
}
