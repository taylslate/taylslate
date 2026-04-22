import { getAuthenticatedUser, getShowProfileByUserId } from "@/lib/data/queries";
import CadenceForm from "./cadence-form";

export default async function CadencePage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getShowProfileByUserId(user.id) : null;
  return <CadenceForm initialValue={initial?.episode_cadence ?? null} />;
}
