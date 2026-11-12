import { notFound, redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { ownershipLabels } from "@/lib/ownership/status";
import { requireShowProfile } from "@/lib/youtube-oauth/store";
import { createClient } from "@/lib/supabase/server";
import OwnershipClient, { ownershipView, type OwnershipProofInput } from "./ownership-client";

export const dynamic = "force-dynamic";

function logRead(code: string | undefined): void {
  console.error("[ownership]", code ?? "unknown", "");
}

export default async function OwnershipSettingsPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?next=/settings/ownership");

  const show = await requireShowProfile(user.id);
  if (!show.ok) notFound();

  const supabase = await createClient();
  const [proofsResult, profileResult] = await Promise.all([
    supabase
      .from("show_ownership_proofs")
      .select("method, status, target, code_expires_at, created_at, decision_note, decided_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase.from("show_profiles").select("feed_url").eq("user_id", user.id).maybeSingle(),
  ]);

  if (proofsResult.error) logRead(proofsResult.error.code);
  if (profileResult.error) logRead(profileResult.error.code);

  if (proofsResult.error || profileResult.error) {
    return (
      <OwnershipClient
        view={{
          kind: "not_started",
          feedUrl: null,
          youtubeAvailable: false,
          target: null,
          medium: null,
          pendingLabel: ownershipLabels.pending,
          verifiedLabel: ownershipLabels.verified,
          loadError: true,
        }}
      />
    );
  }

  const proofs = (proofsResult.data ?? []) as OwnershipProofInput[];
  const feedUrl = typeof profileResult.data?.feed_url === "string" ? profileResult.data.feed_url : null;
  const view = ownershipView({
    proofs,
    feedUrl,
    youtubeAvailable: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
    pendingLabel: ownershipLabels.pending,
    verifiedLabel: ownershipLabels.verified,
  });

  return <OwnershipClient view={view} />;
}
