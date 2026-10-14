// POST /api/admin/managed-brands/[id]/handoff
//
// Hand a managed brand to its owner by changing the email on the existing
// auth user. Admin only: 401 signed out, 403 otherwise. A second call on
// an already-unmanaged account returns 409 and changes nothing.

import { NextRequest, NextResponse } from "next/server";
import { handoffManagedBrand } from "@/lib/accounts/handoff";
import { isInternalAdmin } from "@/lib/auth/admin";
import { getAuthenticatedUser } from "@/lib/data/queries";

export const runtime = "nodejs";

function siteOrigin(req: NextRequest): string {
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  return new URL(req.url).origin;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isInternalAdmin(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id } = await params;
  try {
    const result = await handoffManagedBrand({
      profileId: id,
      newEmail: body.email,
      actor: { id: user.id, email: user.email ?? "" },
      origin: siteOrigin(request),
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      id: result.id,
      email: result.email,
      isManaged: result.isManaged,
      emailSent: result.emailSent,
    });
  } catch (err) {
    console.error(
      "[handoff] threw:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: "Couldn't hand off the account" },
      { status: 500 },
    );
  }
}
