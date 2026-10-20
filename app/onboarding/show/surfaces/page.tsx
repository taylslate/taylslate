import { getAuthenticatedUser } from "@/lib/data/queries";
import { listOwnerSurfaces } from "@/lib/data/show-surfaces";
import SurfacesForm from "./surfaces-form";

export default async function ShowSurfacesPage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await listOwnerSurfaces(user.id) : [];
  return <SurfacesForm initial={initial} />;
}
