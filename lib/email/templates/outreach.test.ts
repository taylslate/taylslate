import { describe, it, expect } from "vitest";
import { renderOutreachEmail } from "./outreach";
import { renderBrandNotification } from "./outreach-response-brand";
import { renderMagicLinkEmail } from "./magic-link";

const baseInput = {
  show_name: "The Daily Briefing",
  to_email: "host@daily.fm",
  brand_name: "Aurora Sleep",
  brand_url: "https://aurora.example",
  pitch_body: "We love your show.\n\nWould love to chat.",
  proposed_cpm: 28.5,
  proposed_episode_count: 4,
  proposed_placement: "mid-roll" as const,
  proposed_flight_start: "2026-05-01",
  proposed_flight_end: "2026-05-30",
  pitch_url: "https://app/outreach/abc",
};

describe("renderOutreachEmail", () => {
  it("uses brand name as the from-name and Taylslate as the send domain", () => {
    const out = renderOutreachEmail(baseInput);
    expect(out.from).toMatch(/^Aurora Sleep <outreach@taylslate\.com>$/);
    expect(out.reply_to).toBe("outreach@taylslate.com");
  });

  it("subject is brand x show", () => {
    const out = renderOutreachEmail(baseInput);
    expect(out.subject).toBe("Aurora Sleep x The Daily Briefing — quick intro");
  });

  it("escapes HTML in body and surfaces proposed terms", () => {
    const out = renderOutreachEmail({
      ...baseInput,
      pitch_body: "<script>bad()</script>\n\nLine 2",
    });
    expect(out.html).not.toContain("<script>bad()</script>");
    expect(out.html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(out.html).toContain("$28.50");
    expect(out.html).toContain("4 episodes");
    expect(out.html).toContain("Mid-roll");
  });

  it("text version includes terms and pitch link", () => {
    const out = renderOutreachEmail(baseInput);
    expect(out.text).toContain("Proposed CPM: $28.50");
    expect(out.text).toContain("https://app/outreach/abc");
    expect(out.text).toContain("Episodes: 4");
  });
});

describe("renderBrandNotification", () => {
  const base = {
    brand_name: "Aurora Sleep",
    show_name: "The Daily Briefing",
    campaign_name: "Spring Launch",
    campaign_url: "https://app/campaigns/x",
    outreach_url: "https://app/campaigns/x/outreach",
    proposed_cpm: 28.5,
  };

  it("formats accepted email", () => {
    const out = renderBrandNotification({ ...base, status: "accepted" });
    expect(out.subject).toContain("Accepted");
    expect(out.html).toContain("accepted your offer");
    expect(out.html).toContain("Build the IO");
  });

  it("formats counter email with delta", () => {
    const out = renderBrandNotification({
      ...base,
      status: "countered",
      counter_cpm: 32,
      counter_message: "Need a 4-spot minimum.",
    });
    expect(out.subject).toContain("$32.00");
    expect(out.html).toContain("$32.00");
    expect(out.html).toContain("$3.50 above your offer");
    expect(out.html).toContain("Need a 4-spot minimum.");
  });

  it("formats decline email with reason", () => {
    const out = renderBrandNotification({
      ...base,
      status: "declined",
      decline_reason: "Not a fit right now.",
    });
    expect(out.subject.startsWith("Declined:")).toBe(true);
    expect(out.html).toContain("Not a fit right now.");
  });
});

describe("renderMagicLinkEmail", () => {
  it("includes link and brand name", () => {
    const out = renderMagicLinkEmail({
      to_email: "host@daily.fm",
      brand_name: "Aurora",
      show_name: "Daily Briefing",
      magic_link_url: "https://app/auth/magic?token=abc",
    });
    expect(out.subject).toContain("Aurora");
    expect(out.html).toContain("https://app/auth/magic?token=abc");
    expect(out.text).toContain("Aurora");
  });
});
