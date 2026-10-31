import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RosterImportResultRow } from "@/lib/reps/roster-import";

type Row = Record<string, unknown>;
type Sent = {
  to: string;
  subject: string;
  html: string;
  text: string;
  recipientProfileId?: string;
  from?: string;
};

const { sendEmail, adminFrom, db, calls } = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  adminFrom: vi.fn(),
  db: {
    profiles: [] as Row[],
    shows: [] as Row[],
    show_ownership_proofs: [] as Row[],
    agent_show_relationships: [] as Row[],
  },
  calls: [] as { table: string; filters: { op: string; column: string; value: unknown }[] }[],
}));

vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => adminFrom(...args) },
}));

import {
  ROSTER_OWNER_EMAIL_CAP,
  loadOwnerRosterLink,
  notifyRosterDispute,
  notifyRosterImportCommit,
  notifyRosterLinkDecision,
  rosterAdminAlertEmail,
} from "./roster-notify";

const AGENT = "agent-1";
const OWNER = "owner-1";
const OWNER_EMAIL = "owner@example.com";
const REP_EMAIL = "rep-secret@example.com";
const ALERT = "alerts@example.com";

function row(partial: Partial<RosterImportResultRow> & Pick<RosterImportResultRow, "class">): RosterImportResultRow {
  return {
    index: 0,
    match_tier: null,
    show_id: null,
    show_name: null,
    needs_confirm: false,
    exclusive_conflict: false,
    reasons: [],
    is_exclusive: true,
    link_id: null,
    committed: false,
    ...partial,
  };
}

function installAdmin() {
  adminFrom.mockImplementation((table: string) => {
    const filters: { op: "eq" | "in"; column: string; value: unknown }[] = [];
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    builder.select = vi.fn(self);
    builder.eq = vi.fn((column: string, value: unknown) => {
      filters.push({ op: "eq", column, value });
      return builder;
    });
    builder.in = vi.fn((column: string, value: unknown) => {
      filters.push({ op: "in", column, value });
      return builder;
    });
    builder.limit = vi.fn(self);
    const run = () => {
      calls.push({
        table,
        filters: filters.map((filter) => ({ ...filter })),
      });
      const source = db[table as keyof typeof db] ?? [];
      return source.filter((item) =>
        filters.every((filter) => {
          if (filter.op === "eq") return item[filter.column] === filter.value;
          return (filter.value as unknown[]).includes(item[filter.column]);
        })
      );
    };
    builder.maybeSingle = vi.fn(async () => ({ data: run()[0] ?? null, error: null }));
    builder.then = (
      resolve: (value: { data: Row[]; error: null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve({ data: run(), error: null }).then(resolve, reject);
    return builder;
  });
}

function sent(): Sent[] {
  return sendEmail.mock.calls.map((call) => call[0] as Sent);
}

function proofShowIds(): string[] {
  const ids: string[] = [];
  for (const call of calls) {
    if (call.table !== "show_ownership_proofs") continue;
    for (const filter of call.filters) {
      if (filter.op === "in" && filter.column === "show_id") {
        ids.push(...(filter.value as string[]));
      }
    }
  }
  return ids;
}

beforeEach(() => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ ok: true, id: "mail-1" });
  adminFrom.mockReset();
  db.profiles = [];
  db.shows = [];
  db.show_ownership_proofs = [];
  db.agent_show_relationships = [];
  calls.length = 0;
  installAdmin();
  process.env.INTERNAL_ALERT_EMAIL = ALERT;
});

describe("notifyRosterImportCommit", () => {
  it("sends one admin email for three committed rows and none for a retry", async () => {
    db.profiles.push({
      id: AGENT,
      email: REP_EMAIL,
      company_name: "Northwind",
      full_name: "Ada",
    });
    const committed = ["One", "Two", "Three"].map((name, index) =>
      row({
        class: index === 2 ? "link_existing" : "new_show",
        committed: true,
        link_id: `link-${index}`,
        show_id: `show-${index}`,
        show_name: name,
      })
    );
    await notifyRosterImportCommit({ agentId: AGENT, rows: committed });
    const admin = sent().filter((mail) => mail.to === ALERT);
    expect(admin).toHaveLength(1);
    expect(admin[0].from).toBeUndefined();
    expect(admin[0].recipientProfileId).toBeUndefined();
    const body = `${admin[0].subject}\n${admin[0].html}\n${admin[0].text}`;
    expect(body).toContain("3 roster links");
    expect(body).toContain("Northwind");
    expect(body).toContain("2 are new shows.");
    expect(body).toContain("1 links to a show already in the catalog.");
    expect(body).toContain("https://www.taylslate.com/admin/roster-requests");
    expect(sent().some((mail) => mail.to === REP_EMAIL)).toBe(false);

    sendEmail.mockClear();
    calls.length = 0;
    await notifyRosterImportCommit({
      agentId: AGENT,
      rows: committed.map((item) => ({ ...item, committed: false, class: "already_on_roster" })),
    });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("sends nothing when no row was committed", async () => {
    await notifyRosterImportCommit({
      agentId: AGENT,
      rows: [row({ class: "invalid", committed: false })],
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("names at most five shows", async () => {
    const rows = ["A", "B", "C", "D", "E", "Secret Six"].map((name, index) =>
      row({
        class: "new_show",
        committed: true,
        link_id: `link-${index}`,
        show_id: `show-${index}`,
        show_name: name,
      })
    );
    await notifyRosterImportCommit({ agentId: AGENT, rows });
    const body = `${sent()[0].html}\n${sent()[0].text}`;
    expect(body).toContain("A");
    expect(body).toContain("E");
    expect(body).not.toContain("Secret Six");
  });

  it("leaves the caller alone when send fails or throws, and logs no address or note", async () => {
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const rows = [
      row({
        class: "new_show",
        committed: true,
        link_id: "link-1",
        show_id: "show-1",
        show_name: "Odd Lots",
      }),
    ];
    sendEmail.mockResolvedValueOnce({ ok: false, reason: "send_failed" });
    await expect(notifyRosterImportCommit({ agentId: AGENT, rows })).resolves.toBeUndefined();

    sendEmail.mockRejectedValueOnce(
      Object.assign(new Error(`failed ${REP_EMAIL} SECRET-NOTE`), { name: "ResendError" })
    );
    await expect(notifyRosterImportCommit({ agentId: AGENT, rows })).resolves.toBeUndefined();
    const logged = errors.flat().map(String).join(" ");
    expect(logged).toContain("send_failed");
    expect(logged).toContain("ResendError");
    expect(logged).not.toContain(REP_EMAIL);
    expect(logged).not.toContain("SECRET-NOTE");
    expect(logged).not.toContain("@");
    spy.mockRestore();
  });

  it("emails a verified owner once per commit and skips everyone else", async () => {
    db.profiles.push(
      { id: AGENT, email: REP_EMAIL, company_name: "Northwind", full_name: "Ada" },
      { id: OWNER, email: OWNER_EMAIL, company_name: null, full_name: "Host" },
      { id: "pending-owner", email: "pending@example.com", company_name: null, full_name: "Pending" },
      { id: "contact-owner", email: "contact-match@example.com", company_name: null, full_name: "Contact" }
    );
    db.shows.push(
      { id: "show-verified", ownership_status: "verified", contact_email: "contact-match@example.com", podscan_id: "pod-1" },
      { id: "show-also", ownership_status: "verified" },
      { id: "show-unclaimed", ownership_status: "unclaimed", contact_email: "contact-match@example.com" },
      { id: "show-pending", ownership_status: "verified" },
      { id: "show-self", ownership_status: "verified" }
    );
    db.show_ownership_proofs.push(
      { show_id: "show-verified", user_id: OWNER, status: "verified" },
      { show_id: "show-also", user_id: OWNER, status: "verified" },
      { show_id: "show-unclaimed", user_id: "contact-owner", status: "verified" },
      { show_id: "show-pending", user_id: "pending-owner", status: "pending" },
      { show_id: "show-self", user_id: AGENT, status: "verified" }
    );

    await notifyRosterImportCommit({
      agentId: AGENT,
      rows: [
        row({ class: "new_show", committed: true, link_id: "link-new", show_id: "show-new", show_name: "Brand New" }),
        row({ class: "link_existing", committed: true, link_id: "link-a", show_id: "show-verified", show_name: "Odd Lots" }),
        row({ class: "exclusive_conflict", committed: true, link_id: "link-b", show_id: "show-also", show_name: "Acquired" }),
        row({ class: "link_existing", committed: true, link_id: "link-c", show_id: "show-unclaimed", show_name: "Quiet" }),
        row({ class: "link_existing", committed: true, link_id: "link-d", show_id: "show-pending", show_name: "Pending Proof" }),
        row({ class: "link_existing", committed: true, link_id: "link-e", show_id: "show-self", show_name: "Own Show" }),
      ],
    });

    expect(proofShowIds()).toEqual(expect.arrayContaining(["show-verified", "show-also", "show-pending", "show-self"]));
    expect(proofShowIds()).not.toContain("show-unclaimed");
    expect(proofShowIds()).not.toContain("show-new");

    const ownerMail = sent().filter((mail) => mail.to === OWNER_EMAIL);
    expect(ownerMail).toHaveLength(1);
    expect(ownerMail[0].recipientProfileId).toBe(OWNER);
    const body = `${ownerMail[0].subject}\n${ownerMail[0].html}\n${ownerMail[0].text}`;
    expect(body).toContain("Odd Lots");
    expect(body).toContain("Acquired");
    expect(body).toContain("Northwind");
    expect(body).toContain("https://www.taylslate.com/shows/roster-links/link-a");
    expect(body).toContain("https://www.taylslate.com/shows/roster-links/link-b");
    expect(body).not.toContain(REP_EMAIL);
    expect(body).not.toContain("pending@example.com");
    expect(body).not.toContain("contact-match@example.com");
    expect(body).not.toContain("Quiet");
    expect(body).not.toContain("Pending Proof");
    expect(body).not.toContain("Own Show");
    expect(body).not.toContain("Brand New");
    expect(body.toLowerCase()).not.toContain("commission");
    expect(body.toLowerCase()).not.toContain("exclusiv");
    expect(sent().some((mail) => mail.to === "pending@example.com")).toBe(false);
    expect(sent().some((mail) => mail.to === "contact-match@example.com")).toBe(false);
    expect(sent().some((mail) => mail.to === REP_EMAIL)).toBe(false);
  });

  it("caps owner mail at 50 and logs only the overflow count", async () => {
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    db.profiles.push({ id: AGENT, email: REP_EMAIL, company_name: "Northwind", full_name: null });
    const rows: RosterImportResultRow[] = [];
    for (let i = 0; i < ROSTER_OWNER_EMAIL_CAP + 1; i++) {
      const id = `owner-${i}`;
      db.profiles.push({ id, email: `owner-${i}@example.com`, company_name: null, full_name: null });
      db.shows.push({ id: `show-${i}`, ownership_status: "verified" });
      db.show_ownership_proofs.push({ show_id: `show-${i}`, user_id: id, status: "verified" });
      rows.push(
        row({
          class: "link_existing",
          committed: true,
          link_id: `link-${i}`,
          show_id: `show-${i}`,
          show_name: `Show ${i}`,
        })
      );
    }
    await notifyRosterImportCommit({ agentId: AGENT, rows });
    const ownerSends = sent().filter((mail) => mail.to.endsWith("@example.com") && mail.to !== ALERT);
    expect(ownerSends).toHaveLength(ROSTER_OWNER_EMAIL_CAP);
    expect(ownerSends.some((mail) => mail.to === `owner-${ROSTER_OWNER_EMAIL_CAP}@example.com`)).toBe(false);
    const logged = errors.flat().map(String).join(" ");
    expect(logged).toContain("owner_cap 1");
    expect(logged).not.toContain("@example.com");
    spy.mockRestore();
  });
});

describe("notifyRosterLinkDecision", () => {
  it("passes the rep profile id and omits a note on approval", async () => {
    db.agent_show_relationships.push({
      id: "link-1",
      agent_id: AGENT,
      show_id: "show-1",
      status: "approved",
      review_note: "should not be sent",
      shows: { name: "Odd Lots" },
      profiles: { email: REP_EMAIL, company_name: "Northwind", full_name: "Ada" },
    });
    await notifyRosterLinkDecision({ relationshipId: "link-1", decision: "approved" });
    expect(sent()).toHaveLength(1);
    expect(sent()[0].to).toBe(REP_EMAIL);
    expect(sent()[0].recipientProfileId).toBe(AGENT);
    expect(sent()[0].from).toBeUndefined();
    const body = `${sent()[0].subject}\n${sent()[0].html}\n${sent()[0].text}`;
    expect(body).toContain("approved");
    expect(body).toContain("Odd Lots");
    expect(body).not.toContain("should not be sent");
    expect(body).not.toContain("Note:");
  });

  it("sends the stored note escaped, and skips a rep with no email", async () => {
    const note = `<script>alert(1)</script>`;
    db.agent_show_relationships.push({
      id: "link-1",
      agent_id: AGENT,
      show_id: "show-1",
      status: "rejected",
      review_note: note,
      shows: { name: "Odd Lots" },
      profiles: { email: REP_EMAIL, company_name: "", full_name: "Ada" },
    });
    await notifyRosterLinkDecision({ relationshipId: "link-1", decision: "declined" });
    expect(sent()[0].html).toContain("&lt;script&gt;");
    expect(sent()[0].html).not.toContain("<script>");
    expect(sent()[0].text).toContain(note);
    expect(sent()[0].recipientProfileId).toBe(AGENT);

    sendEmail.mockClear();
    db.agent_show_relationships[0].profiles = { email: "  ", company_name: "Northwind", full_name: "Ada" };
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    await notifyRosterLinkDecision({ relationshipId: "link-1", decision: "declined" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(errors.flat().map(String).join(" ")).toContain("no_email");
    expect(errors.flat().map(String).join(" ")).not.toContain(note);
    spy.mockRestore();
  });
});

describe("notifyRosterDispute", () => {
  it("sends one admin email and swallows a throw without the note", async () => {
    await notifyRosterDispute({
      showName: "Odd Lots",
      repLabel: "Northwind",
      ownerEmail: OWNER_EMAIL,
      note: "SECRET-NOTE",
    });
    expect(sent()).toHaveLength(1);
    expect(sent()[0].to).toBe(ALERT);
    expect(sent()[0].recipientProfileId).toBeUndefined();
    expect(`${sent()[0].html}\n${sent()[0].text}`).toContain(OWNER_EMAIL);
    expect(sent()[0].text).toContain("SECRET-NOTE");

    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    sendEmail.mockRejectedValueOnce(
      Object.assign(new Error(`boom ${OWNER_EMAIL} SECRET-NOTE`), { name: "ResendError" })
    );
    await expect(
      notifyRosterDispute({
        showName: "Odd Lots",
        repLabel: "Northwind",
        ownerEmail: OWNER_EMAIL,
        note: "SECRET-NOTE",
      })
    ).resolves.toBeUndefined();
    const logged = errors.flat().map(String).join(" ");
    expect(logged).toContain("ResendError");
    expect(logged).not.toContain(OWNER_EMAIL);
    expect(logged).not.toContain("SECRET-NOTE");
    spy.mockRestore();
  });
});

describe("loadOwnerRosterLink", () => {
  it("returns a verified owner and the same miss for everyone else", async () => {
    db.agent_show_relationships.push({
      id: "link-1",
      show_id: "show-1",
      agent_id: AGENT,
      status: "pending",
      shows: { name: "Odd Lots", ownership_status: "verified" },
    });
    db.profiles.push({ id: AGENT, company_name: "Northwind", full_name: "Ada", email: REP_EMAIL });
    db.show_ownership_proofs.push({ show_id: "show-1", user_id: OWNER, status: "verified" });

    const view = await loadOwnerRosterLink("link-1", OWNER);
    expect(view).toMatchObject({
      ok: true,
      showName: "Odd Lots",
      repLabel: "Northwind",
      status: "pending",
    });

    db.show_ownership_proofs[0].status = "pending";
    expect(await loadOwnerRosterLink("link-1", OWNER)).toEqual({ ok: false });

    db.agent_show_relationships[0].shows = { name: "Odd Lots", ownership_status: "unclaimed" };
    calls.length = 0;
    expect(await loadOwnerRosterLink("link-1", OWNER)).toEqual({ ok: false });
    expect(calls.some((call) => call.table === "show_ownership_proofs")).toBe(false);
    expect(await loadOwnerRosterLink("missing", OWNER)).toEqual({ ok: false });
  });
});

describe("roster notify source", () => {
  it("does not match owners by podscan id or contact email and falls back the admin address", () => {
    const source = readFileSync(join(__dirname, "roster-notify.ts"), "utf8");
    expect(source).not.toMatch(/podscan_id/);
    expect(source).not.toMatch(/contact_email/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/shows\/apply-geography/);
    expect(source).toContain("show_ownership_proofs");
    const previous = process.env.INTERNAL_ALERT_EMAIL;
    delete process.env.INTERNAL_ALERT_EMAIL;
    expect(rosterAdminAlertEmail()).toBe("chris@taylslate.com");
    process.env.INTERNAL_ALERT_EMAIL = previous;
  });
});
