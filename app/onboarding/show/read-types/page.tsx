import { getAuthenticatedUser, getShowProfileByUserId } from "@/lib/data/queries";
import ReadTypesForm from "./read-types-form";

export default async function ReadTypesPage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getShowProfileByUserId(user.id) : null;
  return <ReadTypesForm initialValue={initial?.ad_read_types ?? []} />;
}
