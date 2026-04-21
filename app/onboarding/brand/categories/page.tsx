import { getAuthenticatedUser, getBrandProfileByUserId } from "@/lib/data/queries";
import CategoriesForm from "./categories-form";

export default async function CategoriesPage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getBrandProfileByUserId(user.id) : null;
  return <CategoriesForm initialValue={initial?.content_categories ?? []} />;
}
