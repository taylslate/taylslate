import { notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { loadOwnerRosterLink } from "@/lib/reps/roster-notify";
import { OwnerRosterLinkClient } from "./owner-roster-link-client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OwnerRosterLinkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) notFound();

  const { id } = await params;
  if (!UUID.test(id)) notFound();

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
