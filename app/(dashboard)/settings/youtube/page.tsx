import { notFound, redirect } from "next/navigation";
import { getAuthenticatedUser, getUserProfile } from "@/lib/data/queries";
import { readYoutubeStatus } from "@/lib/youtube-oauth/store";
import YoutubeConnectClient from "./youtube-connect-client";

export const dynamic = "force-dynamic";

export default async function YoutubeSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?next=/settings/youtube");

  const profile = await getUserProfile(user.id);
  if (!profile || profile.role !== "show") notFound();

  const query = await searchParams;
  let status = {
    connected: false,
    channel_id: null as string | null,
    channel_title: null as string | null,
    status: null as "active" | "reauth_required" | "revoked" | null,
    analytics_enabled: false,
  };
  try {
    status = await readYoutubeStatus(user.id);
  } catch {
    status = {
      connected: false,
      channel_id: null,
      channel_title: null,
      status: null,
      analytics_enabled: false,
    };
  }

  return (
    <YoutubeConnectClient
      status={status}
      notice={{
        connected: query.connected === "1",
        error: typeof query.error === "string" ? query.error : null,
      }}
    />
  );
}
