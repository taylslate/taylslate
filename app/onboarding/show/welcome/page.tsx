import { getAuthenticatedUser, getShowProfileByUserId } from "@/lib/data/queries";
import WelcomeForm from "./welcome-form";

export default async function ShowWelcomePage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getShowProfileByUserId(user.id) : null;
  return <WelcomeForm initialValue={initial?.feed_url ?? ""} />;
}
