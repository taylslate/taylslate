// GET /api/deals/[id]/docusign-return
// DocuSign hosted-signing returns the user here after they sign or cancel.
// We just bounce them to the deal page; the actual deal state update comes
// from the webhook (which is the authoritative path — the return URL is
// optional in DocuSign's signing flow).

import { NextRequest, NextResponse } from "next/server";

function siteOrigin(req: NextRequest): string {
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  return new URL(req.url).origin;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const event = url.searchParams.get("event") ?? "unknown";
  return NextResponse.redirect(
    `${siteOrigin(request)}/deals/${id}?signing=${encodeURIComponent(event)}`
  );
}
