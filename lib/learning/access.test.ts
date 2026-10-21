import { describe, expect, it } from "vitest";
import { decideConversionWrite, decideOverrideWrite } from "./access";

const base = {
  userId: "brand-1",
  campaignUserId: "brand-1",
  isAdmin: false,
  role: "brand" as const,
  representedShowIds: [] as string[],
  allowedShowIds: ["show-1"],
  allowedRingIds: ["ring-1"],
  targetKind: "show",
  targetKey: "show-1",
  stance: "test_next",
  note: "rep vouches, test one flight",
};

describe("decideOverrideWrite", () => {
  it("lets the brand note a show on the campaign", () => {
    const decision = decideOverrideWrite(base);
    expect(decision).toMatchObject({ ok: true, authorRole: "brand" });
  });

  it("rejects a show id that is not on the campaign", () => {
    const decision = decideOverrideWrite({
      ...base,
      targetKey: "podscan-user-typed",
    });
    expect(decision).toMatchObject({ ok: false, status: 400 });
  });

  it("requires a note", () => {
    expect(decideOverrideWrite({ ...base, note: "   " })).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("lets a rep note only a catalog show they represent", () => {
    const rep = {
      ...base,
      userId: "rep-1",
      role: "agent" as const,
      representedShowIds: ["show-1"],
    };
    expect(decideOverrideWrite(rep)).toMatchObject({ ok: true, authorRole: "rep" });
    expect(
      decideOverrideWrite({ ...rep, targetKey: "show-2", allowedShowIds: ["show-1", "show-2"] })
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("lets a rep note a style once they represent a show on the campaign", () => {
    const decision = decideOverrideWrite({
      ...base,
      userId: "rep-1",
      role: "agent",
      representedShowIds: ["show-1"],
      targetKind: "style",
      targetKey: "host_read",
    });
    expect(decision).toMatchObject({ ok: true, authorRole: "rep", targetKey: "host_read" });
  });

  it("refuses an agent with no show on the campaign", () => {
    expect(
      decideOverrideWrite({
        ...base,
        userId: "rep-1",
        role: "agent",
        representedShowIds: [],
      })
    ).toMatchObject({ ok: false, status: 403 });
  });
});

describe("decideConversionWrite", () => {
  const report = {
    userId: "brand-1",
    campaignUserId: "brand-1",
    isAdmin: false,
    dealId: "deal-1",
    dealStatus: "completed",
    onCampaign: true,
    conversions: 4 as unknown,
  };

  it("accepts a whole number from the brand", () => {
    expect(decideConversionWrite(report)).toEqual({
      ok: true,
      clear: false,
      dealId: "deal-1",
      conversions: 4,
    });
  });

  it("clears a report back to unknown", () => {
    expect(decideConversionWrite({ ...report, conversions: null })).toMatchObject({
      ok: true,
      clear: true,
    });
  });

  it("rejects a fraction, a string, and a count on a deal that is not on air", () => {
    expect(decideConversionWrite({ ...report, conversions: 1.5 })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(decideConversionWrite({ ...report, conversions: "4" })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(decideConversionWrite({ ...report, dealStatus: "planning" })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(decideConversionWrite({ ...report, dealStatus: "cancelled" })).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("hides a deal that is not on this campaign and blocks other users", () => {
    expect(decideConversionWrite({ ...report, onCampaign: false })).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(
      decideConversionWrite({ ...report, userId: "someone-else" })
    ).toMatchObject({ ok: false, status: 403 });
  });
});
