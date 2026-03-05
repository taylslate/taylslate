import { NextResponse } from "next/server";
import { getAllDeals } from "@/lib/data/deal-store";

export async function GET() {
  const deals = getAllDeals();
  return NextResponse.json({ deals });
}
