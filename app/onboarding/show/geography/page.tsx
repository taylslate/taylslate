import { getAuthenticatedUser, getShowProfileByUserId } from "@/lib/data/queries";
import GeographyForm from "./geography-form";

export default async function GeographyPage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getShowProfileByUserId(user.id) : null;
  return <GeographyForm initialText={initial?.media_kit_text ?? ""} />;
}
