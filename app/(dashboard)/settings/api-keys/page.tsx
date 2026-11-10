import { notFound, redirect } from "next/navigation";
import { listKeys } from "@/lib/api/keys";
import {
  KeySettingsError,
  loadBrandKeySettings,
  toApiKeyResponse,
} from "@/lib/api/key-settings";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { ApiKeysClient } from "./api-keys-client";

export const dynamic = "force-dynamic";

export default async function ApiKeysSettingsPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?next=/settings/api-keys");

  let session;
  try {
    session = await loadBrandKeySettings();
  } catch (err) {
    if (err instanceof KeySettingsError && err.status === 401) {
      redirect("/login?next=/settings/api-keys");
    }
    if (err instanceof KeySettingsError && err.status === 403) {
      notFound();
    }
    throw err;
  }

  try {
    const keys = await listKeys(session.brandId);
    return (
      <ApiKeysClient
        initialKeys={keys.map(toApiKeyResponse)}
        apiAccess={session.apiAccess}
      />
    );
  } catch {
    return <ApiKeysClient initialKeys={[]} apiAccess={session.apiAccess} loadError />;
  }
}
