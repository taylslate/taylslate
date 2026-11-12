import { notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/data/queries";
import {
  listOwnershipQueue,
  ownershipPublicError,
  OWNERSHIP_LOAD_FAILED,
  parseOwnershipQueueStatus,
} from "@/lib/ownership/review";
import { isShowsAdmin } from "@/lib/shows/can-edit-show";
import { OwnershipReviewClient } from "./ownership-review-client";

export const dynamic = "force-dynamic";

export default async function OwnershipReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const user = await getAuthenticatedUser();
  if (!user || !(await isShowsAdmin(user.id))) notFound();

  const params = await searchParams;
  const raw = Array.isArray(params.status) ? params.status[0] : params.status;
  const parsed = parseOwnershipQueueStatus(raw);
  if (!parsed.ok) {
    return <OwnershipReviewClient proofs={[]} filter={null} error={parsed.error} />;
  }

  const listed = await listOwnershipQueue({ status: parsed.status });
  if (!listed.ok) {
    return (
      <OwnershipReviewClient
        proofs={[]}
        filter={parsed.status}
        error={ownershipPublicError(listed.error, OWNERSHIP_LOAD_FAILED)}
      />
    );
  }
  return <OwnershipReviewClient proofs={listed.proofs} filter={parsed.status} error={null} />;
}
