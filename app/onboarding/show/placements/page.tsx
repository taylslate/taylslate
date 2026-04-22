import { getAuthenticatedUser, getShowProfileByUserId } from "@/lib/data/queries";
import PlacementsForm from "./placements-form";

export default async function PlacementsPage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getShowProfileByUserId(user.id) : null;
  return <PlacementsForm initialValue={initial?.placements ?? []} />;
}
