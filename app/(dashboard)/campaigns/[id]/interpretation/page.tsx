// Wave 14 Phase 2A — interpretation page placeholder.
//
// Layer 3's brief intake redirects here after submit. Layer 5 replaces
// this with the real three-zone interpretation flow (primary read, lateral
// rings, confirm-and-run), which triggers POST /api/campaigns/[id]/interpret
// (Layer 4) and renders the result.

import { notFound, redirect } from "next/navigation";
import { getAuthenticatedUser, getCampaignById } from "@/lib/data/queries";

export default async function InterpretationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const campaign = await getCampaignById(id);
  if (!campaign || campaign.user_id !== user.id) notFound();

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">
        {campaign.name}
      </h1>
      <div className="mt-6 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-6">
        <p className="text-sm text-[var(--brand-text)]">
          Brief received. The interpretation step — where we play back how
          we&rsquo;re reading your customer and propose the rings to discover
          against — lands here next.
        </p>
        <p className="text-xs text-[var(--brand-text-muted)] mt-2">
          Your brief is saved; nothing to redo.
        </p>
      </div>
    </div>
  );
}
