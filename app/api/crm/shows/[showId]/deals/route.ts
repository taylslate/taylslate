import { NextResponse } from "next/server";
import { listShowDealHistory } from "@/lib/crm/store";
import { requireCrmBrand } from "../../../gate";
import { crmFailure } from "../../../http";
import { parseShowId } from "../../../validate";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ showId: string }> },
) {
  const gate = await requireCrmBrand();
  if (!gate.ok) return gate.response;

  const { showId } = await params;
  const show = parseShowId(showId);
  if (!show.ok) return show.response;

  try {
    const deals = await listShowDealHistory(gate.brandId, show.value);
    return NextResponse.json({ deals });
  } catch (error) {
    return crmFailure(error);
  }
}
