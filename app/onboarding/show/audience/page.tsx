import { getAuthenticatedUser, getShowProfileByUserId } from "@/lib/data/queries";
import AudienceForm from "./audience-form";

export default async function AudiencePage() {
  const user = await getAuthenticatedUser();
  const initial = user ? await getShowProfileByUserId(user.id) : null;
  return (
    <AudienceForm
      initialValue={initial?.audience_size ?? null}
      podscanEstimate={initial?.audience_size ?? null}
    />
  );
}
