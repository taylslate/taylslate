import { getAuthenticatedUser, getShowProfileByUserId } from "@/lib/data/queries";
import PlatformForm from "./platform-form";

export default async function PlatformPage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getShowProfileByUserId(user.id) : null;
  return <PlatformForm initialValue={initial?.platform ?? null} />;
}
