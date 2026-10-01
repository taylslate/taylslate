import { notFound } from "next/navigation";
import AircheckReviewClient from "./review-client";
import { loadAircheckReview } from "@/lib/airchecks/store";
import { isInternalAdmin } from "@/lib/auth/admin";
import { getAuthenticatedUser } from "@/lib/data/queries";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageProps {
  params: Promise<{ ioLineItemId: string }>;
}

export default async function AircheckReviewPage({ params }: PageProps) {
  const { ioLineItemId } = await params;
  const user = await getAuthenticatedUser();
  if (!user || !isInternalAdmin(user.email)) {
    return (
      <div className="max-w-2xl p-4 sm:p-8">
        <p className="text-sm text-[var(--ts-ink-muted-on-paper)]">
          This page is for Taylslate admins.
        </p>
      </div>
    );
  }
  if (!UUID.test(ioLineItemId)) notFound();

  const view = await loadAircheckReview(ioLineItemId);
  if (!view) notFound();

  return <AircheckReviewClient view={view} />;
}
