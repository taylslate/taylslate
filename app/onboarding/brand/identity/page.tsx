import { getAuthenticatedUser, getBrandProfileByUserId } from "@/lib/data/queries";
import IdentityForm from "./identity-form";

export default async function IdentityPage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getBrandProfileByUserId(user.id) : null;
  return <IdentityForm initialValue={initial?.brand_identity ?? ""} />;
}
