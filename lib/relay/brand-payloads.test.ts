import { describe, expect, it } from "vitest";
import { serializeShow } from "@/lib/api/v1/serializers";
import { projectShowsForViewer } from "@/lib/shows/public-fields";
import { redactOutreachForViewer } from "@/lib/outreach/public";
import {
  redactCampaignContacts,
  redactConvictionUniverse,
  redactScoredShowRecord,
  redactShowContact,
  redactTieredUniverse,
} from "./contact-visibility";

const SHOW = "33333333-3333-4333-8333-333333333333";
const EMAIL = "host@example.test";

const show = {
  id: SHOW,
  name: "Daily",
  platform: "podcast" as const,
  audience_size: 12000,
  categories: ["News"],
  contact: { name: "Ada", email: EMAIL, method: "email" },
};

const campaign = {
  id: "c1",
  name: "Spring",
  recommendations: [{ show_id: SHOW, show_name: "Daily", contact_email: EMAIL }],
  youtube_recommendations: [{ show_id: "yt", show_name: "Tube", contact_email: EMAIL }],
  expansion_opportunities: [{ show_id: "ex", contact_email: EMAIL }],
  outreach_drafts: [{ show_id: SHOW, contact_email: EMAIL, subject: "Hi", body: "Body" }],
  scored_shows: [{ podcastId: SHOW, name: "Daily", contactEmail: EMAIL }],
};

function lockedPayload() {
  const visible = new Set<string>();
  return {
    shows: projectShowsForViewer([show], new Set([SHOW]), visible),
    directSearch: projectShowsForViewer([show], new Set([SHOW]), visible),
    universe: redactConvictionUniverse({ groups: [{ shows: [{ show }] }] }, visible),
    tiered: redactTieredUniverse({ test: [{ showId: SHOW, show }], scale: [], bench: [] }, visible),
    campaign: redactCampaignContacts(campaign),
    planShows: [redactScoredShowRecord(campaign.scored_shows[0])],
    outreachShows: [redactScoredShowRecord(campaign.scored_shows[0])],
    campaignsList: [redactCampaignContacts(campaign)],
    generateDrafts: [{ show_id: SHOW, show_name: "Daily", subject: "Hi", body: "Body" }],
    bulkResults: [{ show_id: SHOW, success: true }],
    campaignOutreach: [
      redactOutreachForViewer({ id: "o1", token: "a.b.c", sent_to_email: EMAIL }, { contactVisible: false }),
    ],
    dealOutreach: redactOutreachForViewer(
      { id: "o1", token: "a.b.c", sent_to_email: EMAIL },
      { contactVisible: false }
    ),
    v1Show: serializeShow(
      { id: SHOW, name: "Daily", contact_email: EMAIL, contact_name: "Ada", contact_method: "email" },
      { contactVisible: false, verified: false }
    ),
  };
}

describe("brand payloads", () => {
  it("does not contain the fixture address before unlock", () => {
    const payload = lockedPayload();
    expect(JSON.stringify(payload)).not.toContain(EMAIL);
    expect(payload.shows[0]).toMatchObject({ contact: { email: "" } });
    expect(payload.bulkResults[0]).not.toHaveProperty("to");
    expect(payload.generateDrafts[0]).not.toHaveProperty("contact_email");
    expect(payload.v1Show.contact.email).toBeNull();
  });

  it("keeps the address for an owner, an admin, and an unlocked deal", () => {
    const visible = new Set([SHOW]);
    const owner = projectShowsForViewer([show], new Set([SHOW]), visible);
    expect(JSON.stringify(owner)).toContain(EMAIL);
    const admin = redactCampaignContacts(campaign);
    const adminPayload = campaign;
    expect(JSON.stringify(adminPayload)).toContain(EMAIL);
    expect(JSON.stringify(admin)).not.toContain(EMAIL);
    const unlocked = redactOutreachForViewer(
      { id: "o1", token: "secret", sent_to_email: EMAIL },
      { contactVisible: true }
    );
    expect(unlocked.sent_to_email).toBe(EMAIL);
    const opened = serializeShow(
      { id: SHOW, name: "Daily", contact_email: EMAIL },
      { contactVisible: true }
    );
    expect(opened.contact.email).toBe(EMAIL);
    expect(redactShowContact(show).contact.email).toBe("");
  });
});
