import { describe, expect, it } from "vitest";
import {
  BRAND_CONTACT_FIELDS,
  MASKED_CONTACT,
  advertiserFieldsForWrite,
  blankAdvertiserContact,
  blankPublisherContact,
  maskIoForViewer,
  revealAdvertiserContact,
  revealPublisherContact,
} from "./io-contact";

const BRAND = "brand-1";
const AGENCY = "agency-1";
const AGENT = "agent-1";
const SHOW = "host@example.test";
const ADV = "brand@example.test";

function deal(overrides: Record<string, unknown> = {}) {
  return {
    brand_id: BRAND,
    agency_id: null as string | null,
    agent_id: AGENT,
    outreach_id: "outreach-1",
    status: "planning",
    brand_signed_at: null as string | null,
    show_signed_at: null as string | null,
    ...overrides,
  };
}

function io() {
  return {
    publisher_contact_email: SHOW,
    advertiser_contact_email: ADV,
    agency_contact_email: "desk@example.test",
    agency_billing_contact: "billing@example.test",
    send_invoices_to: "invoices@example.test",
    advertiser_name: "SaunaBox",
  };
}

const unlocked = {
  status: "show_signed",
  brand_signed_at: "2026-11-01",
  show_signed_at: "2026-11-02",
};

describe("IO contact visibility", () => {
  it("keeps the masked label stable", () => {
    expect(MASKED_CONTACT).toBe("Sent through Taylslate");
    expect(BRAND_CONTACT_FIELDS).toEqual([
      "advertiser_contact_email",
      "agency_contact_email",
      "agency_billing_contact",
      "send_invoices_to",
    ]);
  });

  it("shows a brand its own address and hides the show until unlock", () => {
    const locked = deal();
    expect(revealAdvertiserContact(locked, BRAND, false)).toBe(true);
    expect(revealPublisherContact(locked, BRAND, false)).toBe(false);
    const view = maskIoForViewer(io(), locked, BRAND, false);
    expect(view.advertiser_contact_hidden).toBe(false);
    expect(view.publisher_contact_hidden).toBe(true);
    expect(view.io.advertiser_contact_email).toBe(ADV);
    expect(view.io.publisher_contact_email).toBe("");
  });

  it("shows an agency the brand side and hides the show until unlock", () => {
    const locked = deal({ agency_id: AGENCY });
    expect(revealAdvertiserContact(locked, AGENCY, false)).toBe(true);
    expect(revealPublisherContact(locked, AGENCY, false)).toBe(false);
  });

  it("shows an agent the show side and hides the brand until unlock", () => {
    const locked = deal();
    expect(revealPublisherContact(locked, AGENT, false)).toBe(true);
    expect(revealAdvertiserContact(locked, AGENT, false)).toBe(false);
    const view = maskIoForViewer(io(), locked, AGENT, false);
    expect(view.publisher_contact_hidden).toBe(false);
    expect(view.advertiser_contact_hidden).toBe(true);
    expect(view.io.publisher_contact_email).toBe(SHOW);
    expect(view.io.advertiser_contact_email).toBe("");
    expect(view.io.agency_contact_email).toBe("");
    expect(view.io.agency_billing_contact).toBe("");
    expect(view.io.send_invoices_to).toBe("");
    expect(view.io.advertiser_name).toBe("SaunaBox");
  });

  it("lets an admin see both sides", () => {
    const locked = deal();
    const view = maskIoForViewer(io(), locked, "stranger", true);
    expect(view.publisher_contact_hidden).toBe(false);
    expect(view.advertiser_contact_hidden).toBe(false);
    expect(view.io.publisher_contact_email).toBe(SHOW);
    expect(view.io.advertiser_contact_email).toBe(ADV);
  });

  it("hides both sides from a stranger", () => {
    const view = maskIoForViewer(io(), deal(), "stranger", false);
    expect(view.publisher_contact_hidden).toBe(true);
    expect(view.advertiser_contact_hidden).toBe(true);
    expect(JSON.stringify(view)).not.toContain("example.test");
  });

  it("keeps an agent-created deal's advertiser address for the agent who is the brand", () => {
    const legacy = deal({ brand_id: AGENT, agent_id: AGENT, outreach_id: null });
    const view = maskIoForViewer(io(), legacy, AGENT, false);
    expect(view.advertiser_contact_hidden).toBe(false);
    expect(view.publisher_contact_hidden).toBe(false);
    expect(view.io.advertiser_contact_email).toBe(ADV);
  });

  it("hides the advertiser address from a show-side caller when the brand is someone else", () => {
    const legacy = deal({ brand_id: BRAND, agent_id: AGENT, outreach_id: null });
    const view = maskIoForViewer(io(), legacy, AGENT, false);
    expect(view.advertiser_contact_hidden).toBe(true);
    expect(view.io.advertiser_contact_email).toBe("");
    expect(revealAdvertiserContact(legacy, AGENT, false)).toBe(false);
  });

  it("reveals both sides on a signed Wave 12 deal and hides them again when cancelled", () => {
    const open = deal(unlocked);
    const brand = maskIoForViewer(io(), open, BRAND, false);
    const show = maskIoForViewer(io(), open, AGENT, false);
    expect(brand.publisher_contact_hidden).toBe(false);
    expect(brand.advertiser_contact_hidden).toBe(false);
    expect(show.publisher_contact_hidden).toBe(false);
    expect(show.advertiser_contact_hidden).toBe(false);

    const cancelled = deal({ ...unlocked, status: "cancelled" });
    const locked = maskIoForViewer(io(), cancelled, BRAND, false);
    expect(locked.publisher_contact_hidden).toBe(true);
    expect(locked.advertiser_contact_hidden).toBe(false);
    expect(revealPublisherContact(cancelled, BRAND, false)).toBe(false);
    expect(revealAdvertiserContact(cancelled, AGENT, false)).toBe(false);
  });

  it("stays locked when the outreach id is missing, even if both sides signed", () => {
    const row = deal({ ...unlocked, outreach_id: "" });
    expect(revealPublisherContact(row, BRAND, false)).toBe(false);
    expect(revealAdvertiserContact(row, AGENT, false)).toBe(false);
    expect(revealPublisherContact(deal({ ...unlocked, outreach_id: null }), BRAND, false)).toBe(false);
  });

  it("hides both sides when the deal or the user is missing", () => {
    expect(maskIoForViewer(io(), null, BRAND, true).publisher_contact_hidden).toBe(true);
    expect(maskIoForViewer(io(), null, BRAND, true).advertiser_contact_hidden).toBe(true);
    expect(maskIoForViewer(io(), deal(), "", true).publisher_contact_hidden).toBe(true);
    expect(maskIoForViewer(io(), deal(), null, false).advertiser_contact_hidden).toBe(true);
    expect(JSON.stringify(maskIoForViewer(io(), null, null, true))).not.toContain("example.test");
  });

  it("drops hidden-side keys on a write and keeps the visible side", () => {
    const fields = {
      advertiser_name: "SaunaBox",
      advertiser_contact_email: "planted@example.test",
      agency_contact_email: "planted-agency@example.test",
      agency_billing_contact: "planted-bill@example.test",
      send_invoices_to: "planted-inv@example.test",
      publisher_contact_email: SHOW,
    };
    const hidden = advertiserFieldsForWrite(deal(), AGENT, false, fields);
    for (const key of BRAND_CONTACT_FIELDS) expect(hidden).not.toHaveProperty(key);
    expect(hidden.advertiser_name).toBe("SaunaBox");
    expect(hidden.publisher_contact_email).toBe(SHOW);

    const visible = advertiserFieldsForWrite(deal(), BRAND, false, fields);
    expect(visible.advertiser_contact_email).toBe("planted@example.test");
    expect(blankAdvertiserContact(io(), false).advertiser_contact_hidden).toBe(true);
    expect(blankPublisherContact(io(), true).publisher_contact_hidden).toBe(false);
  });
});
