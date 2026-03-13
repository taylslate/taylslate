import { NextResponse } from "next/server";
import { getAuthenticatedUser, getAllDealsForUser } from "@/lib/data/queries";

export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const deals = await getAllDealsForUser(user.id);
    return NextResponse.json({ deals });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to fetch deals: ${message}` }, { status: 500 });
  }
}
