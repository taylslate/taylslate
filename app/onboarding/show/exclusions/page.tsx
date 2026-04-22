import { getAuthenticatedUser, getShowProfileByUserId } from "@/lib/data/queries";
import ExclusionsForm from "./exclusions-form";

export default async function ExclusionsPage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getShowProfileByUserId(user.id) : null;
  return <ExclusionsForm initialValue={initial?.category_exclusions ?? []} />;
}
