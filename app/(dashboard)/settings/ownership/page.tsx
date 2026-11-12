import { notFound, redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { ownershipLabels } from "@/lib/ownership/status";
import { requireShowProfile } from "@/lib/youtube-oauth/store";
import { createClient } from "@/lib/supabase/server";
import OwnershipClient, { ownershipView, type OwnershipProofInput } from "./ownership-client";

export const dynamic = "force-dynamic";

const O2_PROOF_COLUMNS = "method, status, target, code_expires_at, created_at";
const PROOF_COLUMNS = `${O2_PROOF_COLUMNS}, decision_note, decided_at`;

function logRead(code: string | undefined): void {
  console.error("[ownership]", code ?? "unknown", "");
}

function missingDecisionColumns(code: string | undefined): boolean {
  return code === "42703" || code === "PGRST204";
}

export default async function OwnershipSettingsPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?next=/settings/ownership");

  const show = await requireShowProfile(user.id);
  if (!show.ok) notFound();

  const supabase = await createClient();
  const [firstProofs, profileResult] = await Promise.all([
    supabase
      .from("show_ownership_proofs")
      .select(PROOF_COLUMNS)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase.from("show_profiles").select("feed_url").eq("user_id", user.id).maybeSingle(),
  ]);

  let proofs: OwnershipProofInput[] = (firstProofs.data ?? []) as OwnershipProofInput[];
  let proofsError = firstProofs.error;
  if (proofsError && missingDecisionColumns(proofsError.code)) {
    logRead(proofsError.code);
    const retry = await supabase
      .from("show_ownership_proofs")
      .select(O2_PROOF_COLUMNS)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    proofs = (retry.data ?? []) as OwnershipProofInput[];
    proofsError = retry.error;
  }

  if (proofsError) logRead(proofsError.code);
  if (profileResult.error) logRead(profileResult.error.code);

  if (proofsError || profileResult.error) {
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
