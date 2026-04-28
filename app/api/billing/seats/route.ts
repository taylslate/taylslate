import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { changeSeatsByProfileId } from "@/lib/billing/subscription";

interface SeatsBody {
  delta?: unknown;
}

function parseDelta(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value === 0) {
    return null;
  }
  return value;
}

/** POST { delta: positive integer } adds seats. */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as SeatsBody;
    const delta = parseDelta(body.delta);
    if (delta === null || delta < 0) {
      return NextResponse.json(
        { error: "delta must be a positive integer" },
        { status: 400 }
      );
    }

    const result = await changeSeatsByProfileId(user.id, delta, user.id);
    return NextResponse.json({
      profile: {
        plan: result.profile.plan,
        seat_count: result.profile.seat_count,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Seat change failed: ${message}` },
      { status: 400 }
    );
  }
}

/** DELETE { delta: positive integer } removes that many seats. */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as SeatsBody;
    const delta = parseDelta(body.delta);
    if (delta === null || delta < 0) {
      return NextResponse.json(
        { error: "delta must be a positive integer" },
        { status: 400 }
      );
    }

    const result = await changeSeatsByProfileId(user.id, -delta, user.id);
    return NextResponse.json({
      profile: {
        plan: result.profile.plan,
        seat_count: result.profile.seat_count,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Seat change failed: ${message}` },
      { status: 400 }
    );
  }
}
