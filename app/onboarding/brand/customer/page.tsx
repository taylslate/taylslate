import { getAuthenticatedUser, getBrandProfileByUserId } from "@/lib/data/queries";
import CustomerForm from "./customer-form";

export default async function CustomerPage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getBrandProfileByUserId(user.id) : null;
  return <CustomerForm initialValue={initial?.target_customer ?? ""} />;
}
