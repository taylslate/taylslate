import { NextResponse } from "next/server";
import { deleteContact, updateContact } from "@/lib/crm/store";
import { requireCrmBrand } from "../../../../gate";
import { crmFailure, readJson } from "../../../../http";
import { parseContactId, parseShowId, parseUpdateContact } from "../../../../validate";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ showId: string; contactId: string }> },
) {
  const gate = await requireCrmBrand();
  if (!gate.ok) return gate.response;

  const { showId, contactId } = await params;
  const show = parseShowId(showId);
  if (!show.ok) return show.response;
  const contact = parseContactId(contactId);
  if (!contact.ok) return contact.response;

  const json = await readJson(request);
  if (!json.ok) return json.response;
  const parsed = parseUpdateContact(json.body);
  if (!parsed.ok) return parsed.response;

  try {
    const updated = await updateContact({
      brandId: gate.brandId,
      showId: show.value,
      contactId: contact.value,
      ...parsed.value,
    });
    return NextResponse.json({ contact: updated });
  } catch (error) {
    return crmFailure(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ showId: string; contactId: string }> },
) {
  const gate = await requireCrmBrand();
  if (!gate.ok) return gate.response;

  const { showId, contactId } = await params;
  const show = parseShowId(showId);
  if (!show.ok) return show.response;
  const contact = parseContactId(contactId);
  if (!contact.ok) return contact.response;

  try {
    await deleteContact({
      brandId: gate.brandId,
      showId: show.value,
      contactId: contact.value,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return crmFailure(error);
  }
}
