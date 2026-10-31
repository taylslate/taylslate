import { notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { loadOwnerRosterLink } from "@/lib/reps/roster-notify";
import { OwnerRosterLinkClient } from "./owner-roster-link-client";

export default async function OwnerRosterLinkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) notFound();

  const { id } = await params;
  const access = await loadOwnerRosterLink(id, user.id);
  if (!access.ok) notFound();

  return (
    <OwnerRosterLinkClient
      linkId={access.linkId}
      showName={access.showName}
      repLabel={access.repLabel}
      status={access.status}
    />
  );
}
