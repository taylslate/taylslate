import { getAuthenticatedUser, getShowProfileByUserId } from "@/lib/data/queries";
import BrandHistoryForm from "./brand-history-form";

export default async function BrandHistoryPage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getShowProfileByUserId(user.id) : null;
  return <BrandHistoryForm initialValue={initial?.brand_history ?? []} />;
}
