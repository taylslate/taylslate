import { getAuthenticatedUser, getBrandProfileByUserId } from "@/lib/data/queries";
import GenderForm from "./gender-form";

export default async function GenderPage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getBrandProfileByUserId(user.id) : null;
  return <GenderForm initialValue={initial?.target_gender ?? null} />;
}
