// Roster link mail. Four messages, all from the default notifications sender.
// auth@ is for sign-in only. Callers do not pass `from`.
//
// Owner mail names the rep as company or full name only. It does not
// include another rep, a rep email, commission, exclusivity, another
// show, or an admin note.

import { emailColors, emailParagraph, escapeHtml, renderEmailLayout } from "@/lib/email/layout";

export const ROSTER_REVIEW_URL = "https://www.taylslate.com/admin/roster-requests";

export interface RenderedRosterEmail {
  subject: string;
  html: string;
  text: string;
}

export interface RosterAdminAlertInput {
  repLabel: string;
  count: number;
  newShowCount: number;
  existingShowCount: number;
  /** At most five names. The rest are counted, not named. */
  showNames: string[];
  omittedShowCount: number;
}

export interface RosterRepDecisionInput {
  showName: string;
  decision: "approved" | "declined";
  /** Stored reject note. Ignored when the decision is approved. */
  note?: string | null;
}

export interface RosterOwnerShow {
  name: string;
  linkId: string;
}

export interface RosterOwnerNoticeInput {
  repLabel: string;
  shows: RosterOwnerShow[];
}

export interface RosterDisputeAlertInput {
  showName: string;
  repLabel: string;
  ownerEmail: string;
  note?: string | null;
}

export function rosterDisputeUrl(linkId: string): string {
  return `https://www.taylslate.com/shows/roster-links/${encodeURIComponent(linkId)}`;
}

function linkAnchor(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="color:${emailColors.accent};text-decoration:none;">${escapeHtml(label)}</a>`;
}

function newShowSentence(count: number): string {
  if (count === 1) return "1 is a new show.";
  return `${count} are new shows.`;
}

function existingShowSentence(count: number): string {
  if (count === 1) return "1 links to a show already in the catalog.";
  return `${count} link to shows already in the catalog.`;
}

export function renderRosterAdminAlert(input: RosterAdminAlertInput): RenderedRosterEmail {
  const count = input.count;
  const subject =
    count === 1 ? "1 roster link is waiting for review" : `${count} roster links are waiting for review`;
  const names = input.showNames.slice(0, 5).map((name) => name.trim()).filter(Boolean);
  const named =
    names.length > 0 ? `Shows named here: ${names.join(", ")}.` : "No show names are included.";
  const omitted =
    input.omittedShowCount > 0
      ? " Other shows in this batch are on the review page and are not named here."
      : "";
  const body = `${input.repLabel} submitted ${count} roster ${count === 1 ? "link" : "links"}. ${newShowSentence(input.newShowCount)} ${existingShowSentence(input.existingShowCount)} ${named}${omitted}`;
  const laid = renderEmailLayout({
    preheader: subject,
    headline: subject,
    bodyHtml: emailParagraph(escapeHtml(body)),
    cta: { href: ROSTER_REVIEW_URL, label: "Review roster requests" },
    text: `${body}\n\nReview roster requests: ${ROSTER_REVIEW_URL}`,
  });
  return { subject, html: laid.html, text: laid.text };
}

export function renderRosterRepDecision(input: RosterRepDecisionInput): RenderedRosterEmail {
  const showName = input.showName.trim() || "your show";
  const approved = input.decision === "approved";
  const subject = approved
    ? `Roster link approved for ${showName}`
    : `Roster link declined for ${showName}`;
  const lead = approved
    ? `Taylslate approved your roster link for ${showName}.`
    : `Taylslate declined your roster link for ${showName}.`;
  const note = approved ? "" : input.note?.trim() ?? "";
  const body = note ? `${lead}\n\nNote: ${note}` : lead;
  const noteHtml = note ? emailParagraph(`Note: ${escapeHtml(note)}`) : "";
  const laid = renderEmailLayout({
    preheader: subject,
    headline: subject,
    bodyHtml: `${emailParagraph(escapeHtml(lead))}${noteHtml}`,
    text: body,
  });
  return { subject, html: laid.html, text: laid.text };
}

export function renderRosterOwnerNotice(input: RosterOwnerNoticeInput): RenderedRosterEmail {
  const shows = input.shows.filter((show) => show.linkId.trim() && show.name.trim());
  const repLabel = input.repLabel.trim() || "A Taylslate sales agent";
  const many = shows.length !== 1;
  const subject = many ? `${repLabel} listed your shows` : `${repLabel} listed ${shows[0]?.name ?? "your show"}`;
  const lead = many
    ? `${repLabel} listed these shows on their roster. Taylslate is reviewing them. Nothing is live yet.`
    : `${repLabel} listed ${shows[0]?.name ?? "your show"} on their roster. Taylslate is reviewing it. Nothing is live yet.`;
  const one = shows.length === 1 ? shows[0] : null;
  const extraHtml = one
    ? ""
    : shows
        .map((show) => {
          const href = rosterDisputeUrl(show.linkId);
          return emailParagraph(
            `${escapeHtml(show.name)}. ${linkAnchor(href, "This is not right")}`
          );
        })
        .join("");
  const extraText = one
    ? ""
    : shows
        .map((show) => `${show.name}. This is not right: ${rosterDisputeUrl(show.linkId)}`)
        .join("\n");
  const laid = renderEmailLayout({
    preheader: subject,
    headline: subject,
    bodyHtml: `${emailParagraph(escapeHtml(lead))}${extraHtml}`,
    cta: one ? { href: rosterDisputeUrl(one.linkId), label: "This is not right" } : undefined,
    text: extraText ? `${lead}\n\n${extraText}` : `${lead}\n\nThis is not right: ${rosterDisputeUrl(one?.linkId ?? "")}`,
  });
  return { subject, html: laid.html, text: laid.text };
}

export function renderRosterDisputeAlert(input: RosterDisputeAlertInput): RenderedRosterEmail {
  const subject = "A show owner flagged a roster link";
  const showName = input.showName.trim() || "a show";
  const lead = `${input.ownerEmail} flagged the roster link for ${showName}. The rep is ${input.repLabel}.`;
  const note = input.note?.trim() ?? "";
  const body = note ? `${lead}\n\nNote: ${note}` : lead;
  const noteHtml = note ? emailParagraph(`Note: ${escapeHtml(note)}`) : "";
  const laid = renderEmailLayout({
    preheader: subject,
    headline: subject,
    bodyHtml: `${emailParagraph(escapeHtml(lead))}${noteHtml}`,
    cta: { href: ROSTER_REVIEW_URL, label: "Review roster requests" },
    text: `${body}\n\nReview roster requests: ${ROSTER_REVIEW_URL}`,
  });
  return { subject, html: laid.html, text: laid.text };
}
