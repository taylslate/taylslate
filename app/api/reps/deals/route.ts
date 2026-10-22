import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/reps/session";
import { listRepDeals } from "@/lib/reps/store";

export async function GET(_request: Request) {
  try {
    const gate = await requireAgent();
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const deals = await listRepDeals(gate.agentId);
    return NextResponse.json({ deals });
  } catch (error) {
    console.error("Rep deals read failed:", error);
    return NextResponse.json({ error: "Failed to load deals" }, { status: 500 });
  }
}
