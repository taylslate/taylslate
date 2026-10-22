import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/reps/session";
import { getRepShow, listRosterShowDeals } from "@/lib/reps/store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ showId: string }> }
) {
  try {
    const gate = await requireAgent();
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const { showId } = await params;
    const show = await getRepShow(gate.agentId, showId);
    if (!show) {
      return NextResponse.json({ error: "Show not found" }, { status: 404 });
    }

    const deals = await listRosterShowDeals(gate.agentId, showId);
    return NextResponse.json({ show, deals });
  } catch (error) {
    console.error("Rep show read failed:", error);
    return NextResponse.json({ error: "Failed to load show" }, { status: 500 });
  }
}
