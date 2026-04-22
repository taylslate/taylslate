import { getAuthenticatedUser, getShowProfileByUserId } from "@/lib/data/queries";
import FormatsForm from "./formats-form";

export default async function FormatsPage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getShowProfileByUserId(user.id) : null;
  return <FormatsForm initialValue={initial?.ad_formats ?? []} />;
}
