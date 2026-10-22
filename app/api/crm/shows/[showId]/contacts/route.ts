import { NextResponse } from "next/server";
import { addContact, listContacts } from "@/lib/crm/store";
import { requireCrmBrand } from "../../../gate";
import { crmFailure, readJson } from "../../../http";
import { parseAddContact, parseShowId } from "../../../validate";

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
    const contacts = await listContacts(gate.brandId, show.value);
    return NextResponse.json({ contacts });
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
  const parsed = parseAddContact(json.body);
  if (!parsed.ok) return parsed.response;

  try {
    const contact = await addContact({
      brandId: gate.brandId,
      showId: show.value,
      name: parsed.value.name,
      email: parsed.value.email,
      role: parsed.value.role,
      phone: parsed.value.phone,
    });
    return NextResponse.json({ contact }, { status: 201 });
  } catch (error) {
    return crmFailure(error);
  }
}
