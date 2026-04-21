import { getAuthenticatedUser, getBrandProfileByUserId } from "@/lib/data/queries";
import AgeForm from "./age-form";

export default async function AgePage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getBrandProfileByUserId(user.id) : null;
  return (
    <AgeForm
      initialMin={initial?.target_age_min ?? 25}
      initialMax={initial?.target_age_max ?? 54}
    />
  );
}
