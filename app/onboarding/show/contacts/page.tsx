import { getAuthenticatedUser, getShowProfileByUserId } from "@/lib/data/queries";
import ContactsForm from "./contacts-form";

export default async function ContactsPage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getShowProfileByUserId(user.id) : null;
  return (
    <ContactsForm
      initialAdCopyEmail={initial?.ad_copy_email ?? ""}
      initialBillingEmail={initial?.billing_email ?? ""}
      signingEmail={user?.email ?? ""}
    />
  );
}
