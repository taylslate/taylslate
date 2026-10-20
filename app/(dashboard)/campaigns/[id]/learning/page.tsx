import { notFound, redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { LearningLoadError, resolveLearningPage } from "@/lib/learning/load";
import { buildLearningReview } from "@/lib/learning/review";
import { styleOptions } from "@/lib/learning/styles";
import { LearningReviewClient } from "./learning-review-client";

const REPORTABLE = new Set([
  "completed",
  "live",
  "delivering",
  "show_signed",
  "signed",
]);

export default async function LearningReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  let access;
  try {
    access = await resolveLearningPage(user, id);
  } catch (err) {
    if (err instanceof LearningLoadError) {
      return (
        <div className="bg-[var(--ts-paper)] px-4 py-8 text-[var(--ts-ink-on-paper)] sm:px-8">
          <p className="text-sm">Couldn&apos;t load this review.</p>
        </div>
      );
    }
    throw err;
  }
  if (!access) notFound();

  const review = buildLearningReview(access.bundle.input);
  const names = access.bundle.input.showNames;

  return (
    <LearningReviewClient
      campaignId={id}
      campaignName={access.campaign.name}
      review={review}
      canReport={access.isBrandOwner || access.isAdmin}
      canNote={access.isBrandOwner || access.isAdmin || access.representedShowIds.length > 0}
      shows={access.bundle.allowedShowIds.map((showId) => ({
        id: showId,
        label: names[showId] ?? "Show",
      }))}
      rings={access.bundle.input.rings.map((ring) => ({
        id: ring.id,
        label: ring.label,
      }))}
      styles={styleOptions().map((style) => ({ id: style.key, label: style.label }))}
      deals={review.deals.map((deal) => ({
        dealId: deal.dealId,
        showName: deal.showName,
        reportedConversions: deal.reportedConversions,
        reportable: REPORTABLE.has(deal.status),
      }))}
    />
  );
}
