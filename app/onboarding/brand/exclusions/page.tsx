import { getAuthenticatedUser, getBrandProfileByUserId } from "@/lib/data/queries";
import ExclusionsForm from "./exclusions-form";

export default async function ExclusionsPage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getBrandProfileByUserId(user.id) : null;
  return <ExclusionsForm initialValue={initial?.exclusions ?? ""} />;
}
