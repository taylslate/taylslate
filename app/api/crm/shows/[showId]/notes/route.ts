import { NextResponse } from "next/server";
import { addNote, listNotes } from "@/lib/crm/store";
import { requireCrmBrand } from "../../../gate";
import { crmFailure, readJson } from "../../../http";
import { parseNote, parseShowId } from "../../../validate";

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
    const notes = await listNotes(gate.brandId, show.value);
    return NextResponse.json({ notes });
  } catch (error) {
    return crmFailure(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ showId: string }> },
) {
  const gate = await requireCrmBrand();
  if (!gate.ok) return gate.response;

  const { showId } = await params;
  const show = parseShowId(showId);
  if (!show.ok) return show.response;

  const json = await readJson(request);
  if (!json.ok) return json.response;
  const parsed = parseNote(json.body);
  if (!parsed.ok) return parsed.response;

  try {
    const note = await addNote({
      brandId: gate.brandId,
      showId: show.value,
      body: parsed.value,
    });
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    return crmFailure(error);
  }
}
