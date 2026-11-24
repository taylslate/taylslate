// Who may see an IO contact. Fail closed. Server only.
// Do not import this module from a client component.
// The masked string for screens and PDFs lives here too, and those
// files may import the constant. The reveal helpers stay server-side.

import { isRelayUnlocked } from "@/lib/relay/unlock";

export const MASKED_CONTACT = "Sent through Taylslate";

export const BRAND_CONTACT_FIELDS = [
  "advertiser_contact_email",
  "agency_contact_email",
  "agency_billing_contact",
  "send_invoices_to",
] as const;

export type BrandContactField = (typeof BRAND_CONTACT_FIELDS)[number];

export type IoPartyDeal = {
  agent_id?: string | null;
  brand_id?: string | null;
  agency_id?: string | null;
  outreach_id?: unknown;
  show_signed_at?: string | null;
  brand_signed_at?: string | null;
  status?: string | null;
};

type PublisherIo = { publisher_contact_email?: string | null };

type BrandIo = {
  advertiser_contact_email?: string | null;
  agency_contact_email?: string | null;
  agency_billing_contact?: string | null;
  send_invoices_to?: string | null;
};

export function revealPublisherContact(
  deal: IoPartyDeal,
  userId: string,
  admin: boolean
): boolean {
  if (deal.agent_id === userId || admin) return true;
  const outreachId = deal.outreach_id;
  const wave12 = typeof outreachId === "string" && outreachId.length > 0;
  return wave12 && isRelayUnlocked(deal);
}

export function blankPublisherContact<T extends PublisherIo>(
  io: T,
  reveal: boolean
): { io: T; publisher_contact_hidden: boolean } {
  if (reveal) return { io, publisher_contact_hidden: false };
  return {
    io: { ...io, publisher_contact_email: "" },
    publisher_contact_hidden: true,
  };
}

export function revealAdvertiserContact(
  deal: IoPartyDeal,
  userId: string,
  admin: boolean
): boolean {
  if (deal.brand_id === userId || deal.agency_id === userId || admin) return true;
  const outreachId = deal.outreach_id;
  const wave12 = typeof outreachId === "string" && outreachId.length > 0;
  return wave12 && isRelayUnlocked(deal);
}

export function blankAdvertiserContact<T extends BrandIo>(
  io: T,
  reveal: boolean
): { io: T; advertiser_contact_hidden: boolean } {
  if (reveal) return { io, advertiser_contact_hidden: false };
  return {
    io: {
      ...io,
      advertiser_contact_email: "",
      agency_contact_email: "",
      agency_billing_contact: "",
      send_invoices_to: "",
    },
    advertiser_contact_hidden: true,
  };
}

export function advertiserFieldsForWrite(
  deal: IoPartyDeal,
  userId: string,
  admin: boolean,
  fields: Record<string, unknown>
): Record<string, unknown> {
  if (revealAdvertiserContact(deal, userId, admin)) return fields;
  const next = { ...fields };
  for (const key of BRAND_CONTACT_FIELDS) delete next[key];
  return next;
}

export function maskIoForViewer<T extends PublisherIo & BrandIo>(
  io: T,
  deal: IoPartyDeal | null | undefined,
  userId: string | null | undefined,
  admin: boolean
): { io: T; publisher_contact_hidden: boolean; advertiser_contact_hidden: boolean } {
  if (!deal || !userId) {
    const publisher = blankPublisherContact(io, false);
    const advertiser = blankAdvertiserContact(publisher.io, false);
    return {
      io: advertiser.io,
      publisher_contact_hidden: true,
      advertiser_contact_hidden: true,
    };
  }
  const publisher = blankPublisherContact(
    io,
    revealPublisherContact(deal, userId, admin)
  );
  const advertiser = blankAdvertiserContact(
    publisher.io,
    revealAdvertiserContact(deal, userId, admin)
  );
  return {
    io: advertiser.io,
    publisher_contact_hidden: publisher.publisher_contact_hidden,
    advertiser_contact_hidden: advertiser.advertiser_contact_hidden,
  };
}

/**
 * Preview and deal GET already know a brand by brand_profile and a show
 * by show_profile. Wave 12 rows leave agent_id empty, so those owners are
 * copied onto the party columns this rule reads. The copy is not stored.
 */
export function withProfileParties<T extends IoPartyDeal>(
  deal: T,
  userId: string,
  sides: { brand: boolean; show: boolean }
): T {
  if (!deal || !userId) return deal;
  return {
    ...deal,
    ...(sides.brand ? { brand_id: userId } : {}),
    ...(sides.show ? { agent_id: userId } : {}),
  };
}
