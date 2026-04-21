import { getAuthenticatedUser, getBrandProfileByUserId } from "@/lib/data/queries";
import GoalsForm from "./goals-form";

export default async function GoalsPage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getBrandProfileByUserId(user.id) : null;
  return <GoalsForm initialValue={initial?.campaign_goal ?? null} />;
}
