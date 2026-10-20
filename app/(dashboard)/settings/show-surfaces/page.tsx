import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { listOwnerSurfaces } from "@/lib/data/show-surfaces";
import ShowSurfacesSettingsForm from "./show-surfaces-form";

export default async function ShowSurfacesSettingsPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?next=/settings/show-surfaces");
  const initial = await listOwnerSurfaces(user.id);
  return <ShowSurfacesSettingsForm initial={initial} />;
}
