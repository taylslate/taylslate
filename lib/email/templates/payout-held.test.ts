import { describe, expect, it } from "vitest";
import { PAYOUT_HELD_SUBJECT, PAYOUT_HELD_URL, renderPayoutHeldEmail } from "./payout-held";

describe("payout held email", () => {
  it("names the show, links to ownership settings, and leaves out amounts and ids", () => {
    const rendered = renderPayoutHeldEmail({ showName: "Odd <Lots> & Co" });
    const joined = `${rendered.subject}\n${rendered.html}\n${rendered.text}`;
    expect(rendered.subject).toBe(PAYOUT_HELD_SUBJECT);
    expect(rendered.html).toContain("Odd &lt;Lots&gt; &amp; Co");
    expect(rendered.html).not.toContain("Odd <Lots>");
    expect(rendered.text).toContain("Odd <Lots> & Co");
    expect(joined).toContain(PAYOUT_HELD_URL);
    expect(joined).toContain("A brand payment for");
    expect(joined).toContain("it will be sent");
    expect(rendered.subject).not.toMatch(/\d/);
    expect(rendered.text.split("\n")[0]).not.toMatch(/\d/);
    expect(joined).not.toContain("$");
    expect(joined).not.toContain("cents");
    expect(joined).not.toContain("@");
    expect(joined).not.toContain("\u2014");
  });
});
