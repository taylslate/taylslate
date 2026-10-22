import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/reps/session";
import { listRoster } from "@/lib/reps/store";

export async function GET(_request: Request) {
  try {
    const gate = await requireAgent();
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const roster = await listRoster(gate.agentId);
    return NextResponse.json({ roster });
  } catch (error) {
    console.error("Roster read failed:", error);
    return NextResponse.json({ error: "Failed to load roster" }, { status: 500 });
  }
}
