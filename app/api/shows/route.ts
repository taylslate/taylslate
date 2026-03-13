import { NextResponse } from "next/server";
import { getAllShows } from "@/lib/data/queries";

export async function GET() {
  try {
    const shows = await getAllShows();
    return NextResponse.json(shows);
  } catch (error) {
    console.error("Error fetching shows:", error);
    return NextResponse.json({ error: "Failed to fetch shows" }, { status: 500 });
  }
}
