import { describe, expect, it } from "vitest";
import { EMAIL_FROM_NOTIFICATIONS } from "@/lib/email/addresses";
import {
  ROSTER_REVIEW_URL,
  renderRosterAdminAlert,
  renderRosterDisputeAlert,
  renderRosterOwnerNotice,
  renderRosterRepDecision,
  rosterDisputeUrl,
} from "./roster-links";

const LINK_A = "11111111-1111-4111-8111-111111111111";
const LINK_B = "22222222-2222-4222-8222-222222222222";

function joined(rendered: { subject: string; html: string; text: string }): string {
  return `${rendered.subject}\n${rendered.html}\n${rendered.text}`;
}

describe("roster link templates", () => {
  it("names at most five shows on the admin alert and links to review", () => {
    const rendered = renderRosterAdminAlert({
      repLabel: "Northwind",
      count: 6,
      newShowCount: 2,
      existingShowCount: 4,
      showNames: ["One", "Two", "Three", "Four", "Five", "Secret Six"],
      omittedShowCount: 1,
    });
    const text = joined(rendered);
    expect(rendered.subject).toContain("6");
    expect(text).toContain("Northwind");
    expect(text).toContain("2 are new shows.");
    expect(text).toContain("4 link to shows already in the catalog.");
    expect(text).toContain(ROSTER_REVIEW_URL);
    expect(text).toContain("Review roster requests");
    for (const name of ["One", "Two", "Three", "Four", "Five"]) {
      expect(text).toContain(name);
    }
    expect(text).not.toContain("Secret Six");
    expect(text).not.toContain("\u2014");
  });

  it("escapes a decline note and omits it on approval", () => {
    const note = `<script>alert("x")</script> & more`;
    const declined = renderRosterRepDecision({
      showName: "Odd Lots",
      decision: "declined",
      note,
    });
    expect(declined.subject).toContain("declined");
    expect(declined.html).toContain("&lt;script&gt;");
    expect(declined.html).toContain("&amp; more");
    expect(declined.html).not.toContain("<script>");
    expect(declined.text).toContain(note);
    const approved = renderRosterRepDecision({
      showName: "Odd Lots",
      decision: "approved",
      note,
    });
    expect(approved.subject).toContain("approved");
    expect(joined(approved)).not.toContain("script");
    expect(joined(approved)).not.toContain("Note:");
    expect(joined(approved)).not.toContain("\u2014");
  });

  it("gives one owner a button and lists only that owner's shows", () => {
    const one = renderRosterOwnerNotice({
      repLabel: "Northwind",
      shows: [{ name: "Odd Lots", linkId: LINK_A }],
    });
    const oneText = joined(one);
    expect(one.html).toContain("This is not right");
    expect(oneText).toContain(rosterDisputeUrl(LINK_A));
    expect(oneText).toContain("Nothing is live yet.");
    expect(oneText).toContain("Northwind");
    expect(oneText.toLowerCase()).not.toContain("commission");
    expect(oneText.toLowerCase()).not.toContain("exclusiv");
    expect(oneText).not.toContain("@");
    expect(oneText).not.toContain("Southwind");
    expect(oneText).not.toContain("\u2014");

    const many = renderRosterOwnerNotice({
      repLabel: "A Taylslate sales agent",
      shows: [
        { name: "Odd Lots", linkId: LINK_A },
        { name: "Acquired", linkId: LINK_B },
      ],
    });
    const manyText = joined(many);
    expect(manyText).toContain("Odd Lots");
    expect(manyText).toContain("Acquired");
    expect(manyText).toContain(rosterDisputeUrl(LINK_A));
    expect(manyText).toContain(rosterDisputeUrl(LINK_B));
    expect(manyText.toLowerCase()).not.toContain("commission");
    expect(manyText.toLowerCase()).not.toContain("exclusiv");
    expect(manyText).not.toContain("@");
  });

  it("puts the owner email and an escaped note on the dispute alert", () => {
    const rendered = renderRosterDisputeAlert({
      showName: "Odd Lots",
      repLabel: "Northwind",
      ownerEmail: "host@dailybriefing.example",
      note: `<b>Not mine</b>`,
    });
    const text = joined(rendered);
    expect(text).toContain("host@dailybriefing.example");
    expect(text).toContain("Northwind");
    expect(text).toContain("Odd Lots");
    expect(text).toContain(ROSTER_REVIEW_URL);
    expect(rendered.html).toContain("&lt;b&gt;Not mine&lt;/b&gt;");
    expect(rendered.html).not.toContain("<b>");
    expect(rendered.text).toContain("<b>Not mine</b>");
    expect(text).not.toContain("\u2014");
  });

  it("uses the notifications sender in the preview registry only as data", () => {
    expect(EMAIL_FROM_NOTIFICATIONS).toContain("notifications@taylslate.com");
    expect(EMAIL_FROM_NOTIFICATIONS).not.toContain("auth@");
  });
});
