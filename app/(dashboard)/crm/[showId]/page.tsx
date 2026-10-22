import { notFound } from "next/navigation";
import { listContacts, listCrmShows, listNotes, listShowDealHistory } from "@/lib/crm/store";
import { requireBrandCrmAccess } from "../access";
import { CrmShell, crmIndexLede } from "../components/shell";
import { toContactView, toDealView, toNoteView } from "../components/types";
import { UpgradeCard } from "../components/upgrade-card";
import { CrmShowClient } from "./show-client";

export default async function CrmShowPage({
  params,
}: {
  params: Promise<{ showId: string }>;
}) {
  const { showId } = await params;
  const access = await requireBrandCrmAccess();
  if (!access.ok) {
    return (
      <CrmShell kicker="CRM" title="Brand CRM" lede={crmIndexLede(access.brandName)}>
        <UpgradeCard />
      </CrmShell>
    );
  }

  const shows = await listCrmShows(access.userId);
  const show = shows.find((item) => item.id === showId);
  if (!show) notFound();

  const [contacts, notes, deals] = await Promise.all([
    listContacts(access.userId, show.id),
    listNotes(access.userId, show.id),
    listShowDealHistory(access.userId, show.id),
  ]);

  return (
    <CrmShowClient
      show={show}
      brandName={access.brandName}
      contacts={contacts.map(toContactView)}
      notes={notes.map(toNoteView)}
      deals={deals.map(toDealView)}
    />
  );
}
