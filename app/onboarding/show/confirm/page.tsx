import { getAuthenticatedUser, getShowProfileByUserId } from "@/lib/data/queries";
import ConfirmForm from "./confirm-form";

export default async function ShowConfirmPage() {
  const user = await getAuthenticatedUser();
  const profile = user ? await getShowProfileByUserId(user.id) : null;
  return <ConfirmForm profile={profile} />;
}
