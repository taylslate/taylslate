import { NextResponse } from "next/server";
import { listCrmShows } from "@/lib/crm/store";
import { requireCrmBrand } from "../gate";
import { crmFailure } from "../http";

export async function GET(_request: Request) {
  const gate = await requireCrmBrand();
  if (!gate.ok) return gate.response;

  try {
    const shows = await listCrmShows(gate.brandId);
    return NextResponse.json({ shows });
  } catch (error) {
    return crmFailure(error);
  }
}
