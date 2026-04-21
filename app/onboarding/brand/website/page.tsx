import { getAuthenticatedUser, getBrandProfileByUserId } from "@/lib/data/queries";
import WebsiteForm from "./website-form";

export default async function WebsitePage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getBrandProfileByUserId(user.id) : null;
  return <WebsiteForm initialValue={initial?.brand_website ?? ""} />;
}
