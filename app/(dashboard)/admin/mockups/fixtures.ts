// Static preview data for the admin mockups.
// Field names follow brand_show_contacts, brand_show_notes, deal history,
// past_campaign_imports, past_campaign_records, and agent_show_relationships.
// Nothing here is loaded from a database.

import type { PlanId } from "@/lib/billing/plans";

export const SHOW_ACQUIRED = "8f3c1a20-4b6e-4c11-9a2d-111111111111";
export const SHOW_SMARTLESS = "8f3c1a20-4b6e-4c11-9a2d-222222222222";
export const SHOW_JOURNAL = "8f3c1a20-4b6e-4c11-9a2d-333333333333";
export const SHOW_ODD_LOTS = "8f3c1a20-4b6e-4c11-9a2d-444444444444";
export const SHOW_REWATCHABLES = "8f3c1a20-4b6e-4c11-9a2d-555555555555";
export const SHOW_CRIME_JUNKIE = "8f3c1a20-4b6e-4c11-9a2d-666666666666";

export const CRM_NAME_MAX = 200;
export const CRM_NOTE_MAX = 2000;
export const POOLING_TERMS_VERSION = "pooling-v1";

export const PREVIEW_PLANS: PlanId[] = ["pay_as_you_go", "starter", "operator"];

export interface MockShow {
  id: string;
  name: string;
  medium: string;
}

export interface MockContact {
  id: string;
  showId: string;
  name: string;
  email: string | null;
  role: string | null;
  phone: string | null;
  createdAt: string;
}

export interface MockNote {
  id: string;
  showId: string;
  body: string;
  createdAt: string;
}

export interface MockDealHistory {
  id: string;
  showId: string;
  status: string;
  numEpisodes: number | null;
  placement: string | null;
  cpmRate: number | null;
  totalGross: number | null;
  flightStart: string | null;
  flightEnd: string | null;
}

export interface MockImportRecord {
  id: string;
  showName: string;
  matchedShowId: string | null;
  matchedShowName: string | null;
  flightStart: string;
  flightEnd: string;
  placement: string;
  priceType: "cpm" | "flat" | "";
  rate: string;
  episodes: string;
  spend: string;
  conversions: string;
  downloads: string;
}

export type RosterStatus = "pending" | "approved" | "rejected";
export type RosterSource = "admin" | "import" | "claim";

export interface MockRosterLink {
  id: string;
  agentName: string;
  showId: string;
  showName: string;
  status: RosterStatus;
  source: RosterSource;
  isExclusive: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface MockRepDeal {
  id: string;
  showId: string;
  showName: string;
  status: string;
  flightStart: string;
  flightEnd: string;
}

export interface MockApiKey {
  id: string;
  name: string;
  scopes: string[];
  prefix: string;
  lastUsed: string | null;
  status: "active" | "revoked";
  createdAt: string;
}

export interface MockApproval {
  id: string;
  title: string;
  detail: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
}

export const API_SCOPES = [
  { id: "campaigns:read", label: "Read campaigns" },
  { id: "deals:read", label: "Read deals" },
  { id: "shows:read", label: "Read shows" },
  { id: "crm:read", label: "Read CRM" },
] as const;

export const CRM_SHOWS: MockShow[] = [
  { id: SHOW_ACQUIRED, name: "Acquired", medium: "Podcast" },
  { id: SHOW_SMARTLESS, name: "SmartLess", medium: "Podcast" },
  { id: SHOW_JOURNAL, name: "The Journal", medium: "Podcast" },
];

export const CRM_CONTACTS: MockContact[] = [
  {
    id: "contact-acquired-maya",
    showId: SHOW_ACQUIRED,
    name: "Maya Chen",
    email: "maya@acquired.fm",
    role: "Producer",
    phone: "415-555-0148",
    createdAt: "2026-02-12T15:00:00Z",
  },
  {
    id: "contact-acquired-david",
    showId: SHOW_ACQUIRED,
    name: "David Rosenthal",
    email: "david@acquired.fm",
    role: "Host",
    phone: null,
    createdAt: "2026-02-12T15:05:00Z",
  },
  {
    id: "contact-smartless-booking",
    showId: SHOW_SMARTLESS,
    name: "Booking desk",
    email: "ads@smartless.com",
    role: "Sales",
    phone: null,
    createdAt: "2026-01-20T18:30:00Z",
  },
];

export const CRM_NOTES: MockNote[] = [
  {
    id: "note-acquired-1",
    showId: SHOW_ACQUIRED,
    body: "Host mentioned a home sauna in episode 214. A personal-experience read fits.",
    createdAt: "2026-03-04T17:10:00Z",
  },
  {
    id: "note-acquired-2",
    showId: SHOW_ACQUIRED,
    body: "Ask Maya before pitching a second flight. They hold category exclusivity for 90 days.",
    createdAt: "2026-04-02T14:00:00Z",
  },
  {
    id: "note-smartless-1",
    showId: SHOW_SMARTLESS,
    body: "Rates came back above the test budget. Keep the contact for a later scale flight.",
    createdAt: "2026-02-28T16:45:00Z",
  },
];

export const CRM_DEALS: MockDealHistory[] = [
  {
    id: "deal-acquired-live",
    showId: SHOW_ACQUIRED,
    status: "delivering",
    numEpisodes: 3,
    placement: "mid-roll",
    cpmRate: 25,
    totalGross: 4500,
    flightStart: "2026-03-02",
    flightEnd: "2026-04-13",
  },
  {
    id: "deal-acquired-done",
    showId: SHOW_ACQUIRED,
    status: "completed",
    numEpisodes: 3,
    placement: "mid-roll",
    cpmRate: 22,
    totalGross: 3900,
    flightStart: "2025-10-06",
    flightEnd: "2025-10-27",
  },
  {
    id: "deal-smartless-plan",
    showId: SHOW_SMARTLESS,
    status: "planning",
    numEpisodes: 3,
    placement: "pre-roll",
    cpmRate: 40,
    totalGross: 12000,
    flightStart: "2026-05-04",
    flightEnd: "2026-05-25",
  },
];

export const IMPORT_SAMPLE_ROWS: MockImportRecord[] = [
  {
    id: "import-row-acquired",
    showName: "Acquired",
    matchedShowId: SHOW_ACQUIRED,
    matchedShowName: "Acquired",
    flightStart: "2025-06-02",
    flightEnd: "2025-06-23",
    placement: "mid-roll",
    priceType: "cpm",
    rate: "28",
    episodes: "3",
    spend: "5100",
    conversions: "86",
    downloads: "180000",
  },
  {
    id: "import-row-journal",
    showName: "The Journal.",
    matchedShowId: SHOW_JOURNAL,
    matchedShowName: "The Journal",
    flightStart: "2025-07-07",
    flightEnd: "2025-07-28",
    placement: "mid-roll",
    priceType: "flat",
    rate: "8000",
    episodes: "3",
    spend: "8000",
    conversions: "41",
    downloads: "95000",
  },
  {
    id: "import-row-mfm",
    showName: "My First Million",
    matchedShowId: null,
    matchedShowName: null,
    flightStart: "2025-08-04",
    flightEnd: "2025-08-25",
    placement: "pre-roll",
    priceType: "cpm",
    rate: "35",
    episodes: "3",
    spend: "6200",
    conversions: "22",
    downloads: "140000",
  },
];

export const ROSTER_LINKS: MockRosterLink[] = [
  {
    id: "roster-acquired",
    agentName: "Northwind Talent",
    showId: SHOW_ACQUIRED,
    showName: "Acquired",
    status: "approved",
    source: "admin",
    isExclusive: true,
    approvedBy: "Taylor Admin",
    approvedAt: "2026-01-15T12:00:00Z",
  },
  {
    id: "roster-smartless",
    agentName: "Northwind Talent",
    showId: SHOW_SMARTLESS,
    showName: "SmartLess",
    status: "approved",
    source: "import",
    isExclusive: true,
    approvedBy: "Taylor Admin",
    approvedAt: "2026-02-02T12:00:00Z",
  },
  {
    id: "roster-journal",
    agentName: "Northwind Talent",
    showId: SHOW_JOURNAL,
    showName: "The Journal",
    status: "approved",
    source: "claim",
    isExclusive: true,
    approvedBy: "Taylor Admin",
    approvedAt: "2026-02-20T12:00:00Z",
  },
];

export const REP_DEALS: MockRepDeal[] = [
  {
    id: "rep-deal-acquired-live",
    showId: SHOW_ACQUIRED,
    showName: "Acquired",
    status: "delivering",
    flightStart: "2026-03-02",
    flightEnd: "2026-04-13",
  },
  {
    id: "rep-deal-acquired-done",
    showId: SHOW_ACQUIRED,
    showName: "Acquired",
    status: "completed",
    flightStart: "2025-10-06",
    flightEnd: "2025-10-27",
  },
  {
    id: "rep-deal-smartless",
    showId: SHOW_SMARTLESS,
    showName: "SmartLess",
    status: "planning",
    flightStart: "2026-05-04",
    flightEnd: "2026-05-25",
  },
];

export const ROSTER_REQUESTS: MockRosterLink[] = [
  {
    id: "request-odd-lots",
    agentName: "Lena Ortiz",
    showId: SHOW_ODD_LOTS,
    showName: "Odd Lots",
    status: "pending",
    source: "claim",
    isExclusive: true,
    approvedBy: null,
    approvedAt: null,
  },
  {
    id: "request-rewatchables",
    agentName: "Northwind Talent",
    showId: SHOW_REWATCHABLES,
    showName: "The Rewatchables",
    status: "pending",
    source: "import",
    isExclusive: true,
    approvedBy: null,
    approvedAt: null,
  },
  {
    id: "request-acquired",
    agentName: "Northwind Talent",
    showId: SHOW_ACQUIRED,
    showName: "Acquired",
    status: "approved",
    source: "admin",
    isExclusive: true,
    approvedBy: "Taylor Admin",
    approvedAt: "2026-01-15T12:00:00Z",
  },
  {
    id: "request-crime-junkie",
    agentName: "Harbor Reps",
    showId: SHOW_CRIME_JUNKIE,
    showName: "Crime Junkie",
    status: "rejected",
    source: "claim",
    isExclusive: true,
    approvedBy: null,
    approvedAt: null,
  },
];

export const SAMPLE_ROSTER_CSV = ["show_name", "Odd Lots", "The Rewatchables"].join("\n");

export const API_KEYS: MockApiKey[] = [
  {
    id: "key-media-plan",
    name: "Media plan reader",
    scopes: ["campaigns:read", "shows:read"],
    prefix: "ts_mock_01_ab12...",
    lastUsed: "2026-10-12T18:22:00Z",
    status: "active",
    createdAt: "2026-09-01T15:00:00Z",
  },
  {
    id: "key-staging",
    name: "Staging key",
    scopes: ["deals:read"],
    prefix: "ts_mock_02_cd34...",
    lastUsed: "2026-08-02T11:05:00Z",
    status: "revoked",
    createdAt: "2026-07-18T15:00:00Z",
  },
];

export const APPROVALS: MockApproval[] = [
  {
    id: "approval-starter",
    title: "Sauna Box requested Starter",
    detail: "Plan change from Free to Starter. This preview does not bill.",
    requestedAt: "2026-10-18T13:00:00Z",
    status: "pending",
  },
  {
    id: "approval-surface",
    title: "Acquired asked to publish a YouTube surface",
    detail: "Long-form YouTube only. Shorts stay out of the catalog.",
    requestedAt: "2026-10-19T16:40:00Z",
    status: "pending",
  },
  {
    id: "approval-note",
    title: "Publish the learning note on Acquired",
    detail: "The note is visible to the brand after approval.",
    requestedAt: "2026-10-02T09:15:00Z",
    status: "approved",
  },
];

const LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  planning: "Planning",
  delivering: "Delivering",
  completed: "Completed",
  parsed: "Parsed",
  confirmed: "Confirmed",
  discarded: "Discarded",
  active: "Active",
  revoked: "Revoked",
  admin: "Admin",
  import: "Import",
  claim: "Claim",
  csv: "CSV",
  xlsx: "XLSX",
  pdf: "PDF",
  cpm: "CPM",
  flat: "Flat rate",
  "mid-roll": "Mid-roll",
  "pre-roll": "Pre-roll",
  "post-roll": "Post-roll",
  "pay_as_you_go": "Free",
};

export function labelOf(value: string): string {
  return LABELS[value] ?? value;
}

export function formatDay(value: string): string {
  const iso = value.length === 10 ? `${value}T00:00:00Z` : value;
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatFlight(start: string | null, end: string | null): string {
  if (!start && !end) return "Flight not set";
  if (start && end) return `${formatDay(start)} to ${formatDay(end)}`;
  return formatDay(start ?? end ?? "");
}

export function formatUsd(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function previewCanUseCrm(planId: PlanId): boolean {
  return planId === "starter" || planId === "operator" || planId === "agency";
}

export function getCrmShow(showId: string): MockShow | undefined {
  return CRM_SHOWS.find((show) => show.id === showId);
}

export function getRosterShow(showId: string): MockRosterLink | undefined {
  return ROSTER_LINKS.find((link) => link.showId === showId);
}

export function sampleImportRows(): MockImportRecord[] {
  return IMPORT_SAMPLE_ROWS.map((row) => ({ ...row }));
}

export function parseRosterCsv(text: string): { showName: string }[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((cell) => cell.toLowerCase());
  const headerIndex = header.findIndex(
    (cell) => cell === "show" || cell === "show_name" || cell === "name",
  );
  const hasHeader = headerIndex >= 0;
  const nameIndex = hasHeader ? headerIndex : 0;
  const body = hasHeader ? lines.slice(1) : lines;
  return body
    .map((line) => splitCsvLine(line)[nameIndex]?.trim() ?? "")
    .filter(Boolean)
    .map((showName) => ({ showName }));
}

function splitCsvLine(line: string): string[] {
  return line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
}

export interface MockupLink {
  href: string;
  group: string;
  label: string;
  detail: string;
}

export const MOCKUP_LINKS: MockupLink[] = [
  {
    href: "/admin/mockups/crm",
    group: "CRM",
    label: "Brand CRM",
    detail: "Free upgrade card, then contacts, notes, and deal history on a show.",
  },
  {
    href: `/admin/mockups/crm/${SHOW_ACQUIRED}`,
    group: "CRM",
    label: "Acquired",
    detail: "Per-show contacts, notes, and read-only deal history.",
  },
  {
    href: "/admin/mockups/import",
    group: "Import",
    label: "Past campaign import",
    detail: "Choose a file, review rows, consent, then a confirmed summary.",
  },
  {
    href: "/admin/mockups/rep",
    group: "Rep",
    label: "Roster",
    detail: "Exclusive is on for every show until you turn it off.",
  },
  {
    href: "/admin/mockups/rep/deals",
    group: "Rep",
    label: "Rep deals",
    detail: "Roster-link rows show status and flight only.",
  },
  {
    href: `/admin/mockups/rep/shows/${SHOW_ACQUIRED}`,
    group: "Rep",
    label: "Acquired for the rep",
    detail: "One roster show, with flights and the exclusive switch.",
  },
  {
    href: "/admin/mockups/rep/upload",
    group: "Rep",
    label: "Roster CSV",
    detail: "Upload a CSV and preview rows before they join the roster.",
  },
  {
    href: "/admin/mockups/roster-requests",
    group: "Roster requests",
    label: "Roster requests",
    detail: "Pending, approved, and rejected links, with approve and reject.",
  },
  {
    href: "/admin/mockups/api-keys",
    group: "API keys",
    label: "API keys",
    detail: "Create a key, show the secret once, revoke it, and see last used.",
  },
  {
    href: "/admin/mockups/approvals",
    group: "Approvals",
    label: "Approvals",
    detail: "Pending actions with approve and reject.",
  },
];

export const REP_NAV = [
  { href: "/admin/mockups/rep", label: "Roster" },
  { href: "/admin/mockups/rep/deals", label: "Deals" },
  { href: "/admin/mockups/rep/upload", label: "CSV upload" },
];
