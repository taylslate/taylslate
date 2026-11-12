// Consent screen. The proxy keeps this path signed-in. The page checks
// the session again and uses the user id only.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { OAuthUnavailableError } from "@/lib/mcp-oauth/errors";
import { loadConsentView, type ConsentView } from "@/lib/mcp-oauth/consent";
import { ConsentCard } from "./consent-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Connect an app",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OAuthConsentPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  const nextPath = UUID_RE.test(requestId) ? `/oauth/consent/${requestId}` : "/oauth/consent";
  const user = await getAuthenticatedUser();
  if (!user?.id) redirect(`/login?next=${encodeURIComponent(nextPath)}`);

  let view: ConsentView;
  try {
    view = await loadConsentView(requestId, user.id);
  } catch (err) {
    if (err instanceof OAuthUnavailableError) {
      view = { state: "unavailable" };
    } else {
      throw err;
    }
  }

  if (view.state === "ready") {
    return (
      <ConsentCard
        mode="ready"
        requestId={view.requestId}
        clientName={view.clientName}
        redirectHost={view.redirectHost}
        scopes={view.scopes}
      />
    );
  }
  return <ConsentCard mode={view.state} />;
}
