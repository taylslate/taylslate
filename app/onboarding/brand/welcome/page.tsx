import { getAuthenticatedUser, getBrandProfileByUserId } from "@/lib/data/queries";
import WelcomeForm from "./welcome-form";

export default async function WelcomePage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getBrandProfileByUserId(user.id) : null;
  return <WelcomeForm initialValue={initial?.brand_website ?? ""} />;
}
