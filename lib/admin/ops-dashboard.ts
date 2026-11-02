// Read-only assembly for /admin. Every number comes from a select.
// Payment fees are summed from payments rows. This module does not call Stripe.

import { redactSecretParams } from "@/lib/discovery/redact-secrets";
import {
  ACCOUNT_ROLES,
  ACTIVE_DEAL_STATUSES,
  CAMPAIGN_STATUSES,
  type OpsFilters,
  orIlike,
} from "@/lib/admin/ops-filters";
import {
  isMissingColumn,
  isMissingRelation,
  type OpsDb,
  type OpsError,
  type OpsRow,
  type OpsSelect,
} from "@/lib/admin/ops-db";

export const OPS_LIST_LIMIT = 40;
const PAGE_SIZE = 1000;
const MAX_ROWS = 5000;

const EMAIL_CANDIDATES = [
  "contact_email",
  "email",
  "emails",
  "business_email",
  "booking_email",
  "public_email",
  "owner_email",
  "channel_email",
  "found_email",
  "email_found",
  "contact_emails",
] as const;

const ERROR_EVENT_OR = [
  "event_type.ilike.*fail*",
  "event_type.ilike.*error*",
  "event_type.ilike.*rolled_back*",
  "event_type.ilike.*unverified*",
  "event_type.eq.payment.disputed",
].join(",");

const COLLECTED = new Set(["succeeded", "completed"]);
const IN_FLIGHT = new Set(["pending", "processing"]);

export interface OpsAccountRow {
  id: string;
  email: string;
  name: string;
  company: string;
  role: string;
  plan: string;
  createdAt: string;
  managed: boolean;
}

export interface OpsCampaignRow {
  id: string;
  name: string;
  status: string;
  budget: number | null;
  createdAt: string;
  ownerEmail: string;
}

export interface OpsDealRow {
  id: string;
  status: string;
  createdAt: string;
  showName: string;
  brandEmail: string;
  totalGross: number | null;
}

export interface OpsFeeSummary {
  collectedCents: number;
  collectedCount: number;
  missingFeeCount: number;
  last30DaysCents: number;
  inFlightCents: number;
  inFlightCount: number;
  refundedCents: number;
  refundedCount: number;
  disputedCents: number;
  disputedCount: number;
  failedCount: number;
  truncated: boolean;
}

export interface OpsEmailStat {
  column: string;
  count: number;
  approximate: boolean;
}

export interface CountPair {
  key: string;
  count: number;
}

export interface OpsAccountsSection {
  error: string | null;
  listError: string | null;
  counts: CountPair[];
  signups24h: number | null;
  signups7d: number | null;
  matched: number | null;
  rows: OpsAccountRow[];
}

export interface OpsCampaignsSection {
  error: string | null;
  listError: string | null;
  detailNote: string | null;
  counts: CountPair[];
  active: number | null;
  matched: number | null;
  rows: OpsCampaignRow[];
}

export interface OpsDealsSection {
  error: string | null;
  listError: string | null;
  detailNote: string | null;
  counts: CountPair[];
  active: number | null;
  matched: number | null;
  rows: OpsDealRow[];
}

export interface OpsFeesSection {
  error: string | null;
  summary: OpsFeeSummary | null;
}

export interface OpsQueueError {
  id: string;
  createdAt: string;
  kind: string;
  value: string;
  attempts: number;
  lastError: string;
}

export interface OpsQueueDone {
  id: string;
  createdAt: string;
  kind: string;
  value: string;
  status: string;
}

export interface OpsYoutubeSection {
  error: string | null;
  available: boolean;
  unavailableReason: string | null;
  total: number | null;
  passedMarketFilter: number | null;
  added24h: number | null;
  added7d: number | null;
  emails: OpsEmailStat[];
  emailNote: string | null;
  queueAvailable: boolean;
  queueUnavailableReason: string | null;
  queueByStatus: CountPair[];
}

export interface OpsActivitySection {
  error: string | null;
  events: { id: string; eventType: string; entityType: string; entityId: string; createdAt: string }[];
  failedPayments: { id: string; createdAt: string }[];
  queueErrors: OpsQueueError[];
  recentDone: OpsQueueDone[];
}

export interface OpsDashboardData {
  generatedAt: string;
  accounts: OpsAccountsSection;
  campaigns: OpsCampaignsSection;
  deals: OpsDealsSection;
  fees: OpsFeesSection;
  youtube: OpsYoutubeSection;
  activity: OpsActivitySection;
}

export function redactOpsText(value: string): string {
  const cleaned = redactSecretParams(value)
    .replace(/bearer\s+\S+/gi, "bearer [redacted]")
    .replace(/\b(?:sk|pk|rk|whsec|re)_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/\bAIza[0-9A-Za-z_-]{10,}\b/g, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted]");
  return cleaned.replace(/\s+/g, " ").trim().slice(0, 240);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asMoney(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asCents(value: unknown): number | null {
  const n = asMoney(value);
  return n == null ? null : Math.round(n);
}

function asCount(result: { count: number | null; rows: OpsRow[] }): number {
  return result.count ?? result.rows.length;
}

function isoDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function readPages(
  db: OpsDb,
  spec: Omit<OpsSelect, "limit" | "offset" | "head">,
): Promise<{ rows: OpsRow[]; truncated: boolean; error: OpsError | null }> {
  const rows: OpsRow[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const page = await db.select({ ...spec, limit: PAGE_SIZE, offset });
    if (page.error) return { rows, truncated: false, error: page.error };
    rows.push(...page.rows);
    if (page.rows.length < PAGE_SIZE) return { rows, truncated: false, error: null };
  }
  return { rows, truncated: true, error: null };
}

export function summarizeFees(rows: OpsRow[], now: Date, truncated: boolean): OpsFeeSummary {
  const cutoff = isoDaysAgo(now, 30);
  const summary: OpsFeeSummary = {
    collectedCents: 0,
    collectedCount: 0,
    missingFeeCount: 0,
    last30DaysCents: 0,
    inFlightCents: 0,
    inFlightCount: 0,
    refundedCents: 0,
    refundedCount: 0,
    disputedCents: 0,
    disputedCount: 0,
    failedCount: 0,
    truncated,
  };
  for (const row of rows) {
    const status = text(row.status);
    const cents = asCents(row.application_fee_amount_cents);
    const when = text(row.charged_at) || text(row.created_at);
    if (COLLECTED.has(status)) {
      summary.collectedCount += 1;
      if (cents == null) summary.missingFeeCount += 1;
      else {
        summary.collectedCents += cents;
        if (when >= cutoff) summary.last30DaysCents += cents;
      }
    } else if (IN_FLIGHT.has(status)) {
      summary.inFlightCount += 1;
      if (cents != null) summary.inFlightCents += cents;
    } else if (status === "refunded") {
      summary.refundedCount += 1;
      if (cents != null) summary.refundedCents += cents;
    } else if (status === "disputed") {
      summary.disputedCount += 1;
      if (cents != null) summary.disputedCents += cents;
    } else if (status === "failed") {
      summary.failedCount += 1;
    }
  }
  return summary;
}

function accountRow(row: OpsRow): OpsAccountRow {
  const name = text(row.full_name).trim();
  return {
    id: text(row.id),
    email: text(row.email).trim(),
    name: name || "No name",
    company: text(row.company_name).trim(),
    role: text(row.role),
    plan: text(row.plan),
    createdAt: text(row.created_at),
    managed: row.is_managed === true,
  };
}

async function loadAccounts(db: OpsDb, filters: OpsFilters, now: Date): Promise<OpsAccountsSection> {
  const day = isoDaysAgo(now, 1);
  const week = isoDaysAgo(now, 7);
  const listSpec: OpsSelect = {
    table: "profiles",
    columns: "id, email, full_name, company_name, role, plan, created_at, is_managed",
    order: { column: "created_at", ascending: false },
    limit: OPS_LIST_LIMIT,
  };
  if (filters.role !== "all") listSpec.eq = { role: filters.role };
  if (filters.userQ) {
    listSpec.or = orIlike(["email", "full_name", "company_name"], filters.userQ);
  }
  const [brand, show, agency, agent, signups24h, signups7d, list] = await Promise.all([
    db.select({ table: "profiles", columns: "*", head: true, eq: { role: "brand" } }),
    db.select({ table: "profiles", columns: "*", head: true, eq: { role: "show" } }),
    db.select({ table: "profiles", columns: "*", head: true, eq: { role: "agency" } }),
    db.select({ table: "profiles", columns: "*", head: true, eq: { role: "agent" } }),
    db.select({ table: "profiles", columns: "*", head: true, gte: { created_at: day } }),
    db.select({ table: "profiles", columns: "*", head: true, gte: { created_at: week } }),
    db.select(listSpec),
  ]);
  const counts = [brand, show, agency, agent];
  const countFailed = counts.some((result) => result.error) || signups24h.error || signups7d.error;
  return {
    error: countFailed ? "Could not read account counts." : null,
    listError: list.error ? "Could not read the account list." : null,
    counts: countFailed
      ? []
      : ACCOUNT_ROLES.map((role, index) => ({ key: role, count: asCount(counts[index]) })),
    signups24h: signups24h.error ? null : asCount(signups24h),
    signups7d: signups7d.error ? null : asCount(signups7d),
    matched: list.error ? null : asCount(list),
    rows: list.error ? [] : list.rows.map(accountRow),
  };
}

async function statusCounts(
  db: OpsDb,
  table: string,
  statuses: readonly string[],
): Promise<{ error: boolean; counts: CountPair[] }> {
  const results = await Promise.all(
    statuses.map((status) =>
      db.select({ table, columns: "*", head: true, eq: { status } }),
    ),
  );
  if (results.some((result) => result.error)) return { error: true, counts: [] };
  return {
    error: false,
    counts: statuses.map((status, index) => ({ key: status, count: asCount(results[index]) })),
  };
}

async function profileEmails(db: OpsDb, ids: string[]): Promise<{ map: Map<string, string>; error: boolean }> {
  const map = new Map<string, string>();
  if (ids.length === 0) return { map, error: false };
  const result = await db.select({
    table: "profiles",
    columns: "id, email",
    in: { id: ids },
    limit: ids.length,
  });
  if (result.error) return { map, error: true };
  for (const row of result.rows) map.set(text(row.id), text(row.email).trim());
  return { map, error: false };
}

async function loadCampaigns(db: OpsDb, filters: OpsFilters): Promise<OpsCampaignsSection> {
  const counts = await statusCounts(db, "campaigns", CAMPAIGN_STATUSES);
  const listSpec: OpsSelect = {
    table: "campaigns",
    columns: "id, name, status, budget_total, created_at, user_id",
    order: { column: "created_at", ascending: false },
    limit: OPS_LIST_LIMIT,
  };
  if (filters.campaignStatus !== "all") listSpec.eq = { status: filters.campaignStatus };
  if (filters.campaignQ) {
    const people = await db.select({
      table: "profiles",
      columns: "id",
      or: orIlike(["email", "full_name", "company_name"], filters.campaignQ),
      limit: 100,
    });
    if (people.error) {
      return {
        error: counts.error ? "Could not read campaign counts." : null,
        listError: "Could not read the campaign list.",
        detailNote: null,
        counts: counts.counts,
        active: counts.error ? null : (counts.counts.find((item) => item.key === "active")?.count ?? 0),
        matched: null,
        rows: [],
      };
    }
    const ids = people.rows.map((row) => text(row.id)).filter(Boolean);
    const parts = [orIlike(["name"], filters.campaignQ)];
    if (ids.length > 0) parts.push(`user_id.in.(${ids.join(",")})`);
    listSpec.or = parts.join(",");
  }
  const list = await db.select(listSpec);
  const userIds = [...new Set(list.rows.map((row) => text(row.user_id)).filter(Boolean))];
  const owners = list.error ? { map: new Map<string, string>(), error: false } : await profileEmails(db, userIds);
  const active = counts.error ? null : (counts.counts.find((item) => item.key === "active")?.count ?? 0);
  return {
    error: counts.error ? "Could not read campaign counts." : null,
    listError: list.error ? "Could not read the campaign list." : null,
    detailNote: owners.error ? "Account emails for these campaigns could not be read." : null,
    counts: counts.counts,
    active,
    matched: list.error ? null : asCount(list),
    rows: list.error
      ? []
      : list.rows.map((row) => ({
          id: text(row.id),
          name: text(row.name).trim() || "Untitled campaign",
          status: text(row.status),
          budget: asMoney(row.budget_total),
          createdAt: text(row.created_at),
          ownerEmail: owners.map.get(text(row.user_id)) || "No email",
        })),
  };
}

async function loadDeals(db: OpsDb, filters: OpsFilters): Promise<OpsDealsSection> {
  const counts = await statusCounts(db, "deals", [
    "planning",
    "io_sent",
    "brand_signed",
    "show_signed",
    "live",
    "delivering",
    "completed",
    "cancelled",
    "proposed",
    "negotiating",
    "approved",
    "signed",
  ]);
  const listSpec: OpsSelect = {
    table: "deals",
    columns: "id, status, created_at, total_gross, show_id, brand_id",
    order: { column: "created_at", ascending: false },
    limit: OPS_LIST_LIMIT,
  };
  if (filters.dealStatus === "active") listSpec.in = { status: ACTIVE_DEAL_STATUSES };
  else if (filters.dealStatus !== "all") listSpec.eq = { status: filters.dealStatus };

  let emptySearch = false;
  if (filters.dealQ) {
    const [shows, people] = await Promise.all([
      db.select({
        table: "shows",
        columns: "id",
        ilike: { name: `%${filters.dealQ}%` },
        limit: 100,
      }),
      db.select({
        table: "profiles",
        columns: "id",
        or: orIlike(["email", "full_name", "company_name"], filters.dealQ),
        limit: 100,
      }),
    ]);
    if (shows.error || people.error) {
      return {
        error: counts.error ? "Could not read deal counts." : null,
        listError: "Could not read the deal list.",
        detailNote: null,
        counts: counts.counts,
        active: null,
        matched: null,
        rows: [],
      };
    }
    const showIds = shows.rows.map((row) => text(row.id)).filter(Boolean);
    const brandIds = people.rows.map((row) => text(row.id)).filter(Boolean);
    if (showIds.length === 0 && brandIds.length === 0) emptySearch = true;
    else if (showIds.length > 0 && brandIds.length > 0) {
      listSpec.or = `show_id.in.(${showIds.join(",")}),brand_id.in.(${brandIds.join(",")})`;
    } else if (showIds.length > 0) listSpec.in = { ...(listSpec.in ?? {}), show_id: showIds };
    else listSpec.in = { ...(listSpec.in ?? {}), brand_id: brandIds };
  }

  const list = emptySearch ? { rows: [] as OpsRow[], count: 0, error: null } : await db.select(listSpec);
  const showIds = [...new Set(list.rows.map((row) => text(row.show_id)).filter(Boolean))];
  const brandIds = [...new Set(list.rows.map((row) => text(row.brand_id)).filter(Boolean))];
  const [showLookup, brandLookup] = list.error
    ? [
        { rows: [] as OpsRow[], error: null },
        { map: new Map<string, string>(), error: false },
      ]
    : await Promise.all([
        showIds.length
          ? db.select({ table: "shows", columns: "id, name", in: { id: showIds }, limit: showIds.length })
          : Promise.resolve({ rows: [] as OpsRow[], count: 0, error: null }),
        profileEmails(db, brandIds),
      ]);
  const showNames = new Map<string, string>();
  if (!showLookup.error) {
    for (const row of showLookup.rows) showNames.set(text(row.id), text(row.name).trim());
  }
  const active = counts.error
    ? null
    : counts.counts
        .filter((item) => item.key !== "completed" && item.key !== "cancelled")
        .reduce((sum, item) => sum + item.count, 0);
  return {
    error: counts.error ? "Could not read deal counts." : null,
    listError: list.error ? "Could not read the deal list." : null,
    detailNote:
      showLookup.error || brandLookup.error ? "Show or brand names could not be read." : null,
    counts: counts.counts,
    active,
    matched: list.error ? null : asCount(list),
    rows: list.error
      ? []
      : list.rows.map((row) => ({
          id: text(row.id),
          status: text(row.status),
          createdAt: text(row.created_at),
          showName: showNames.get(text(row.show_id)) || "Show not on file",
          brandEmail: brandLookup.map.get(text(row.brand_id)) || "No email",
          totalGross: asMoney(row.total_gross),
        })),
  };
}

async function loadFees(db: OpsDb, now: Date): Promise<OpsFeesSection> {
  const pages = await readPages(db, {
    table: "payments",
    columns: "status, application_fee_amount_cents, charged_at, created_at",
  });
  if (pages.error) return { error: "Could not read platform fees.", summary: null };
  return { error: null, summary: summarizeFees(pages.rows, now, pages.truncated) };
}

async function countHead(
  db: OpsDb,
  spec: Omit<OpsSelect, "columns" | "head">,
): Promise<{ count: number | null; error: OpsError | null }> {
  const result = await db.select({ ...spec, columns: "*", head: true });
  if (result.error) return { count: null, error: result.error };
  return { count: asCount(result), error: null };
}

async function emailColumns(db: OpsDb, sample: OpsRow | undefined): Promise<string[]> {
  if (sample) return Object.keys(sample).filter((key) => /email/i.test(key));
  const found: string[] = [];
  for (const column of EMAIL_CANDIDATES) {
    const probe = await db.select({
      table: "youtube_channels",
      columns: column,
      limit: 1,
    });
    if (!probe.error) found.push(column);
    else if (!isMissingColumn(probe.error)) break;
  }
  return found;
}

async function countEmail(
  db: OpsDb,
  column: string,
  sample: unknown,
): Promise<OpsEmailStat> {
  const attempts: OpsSelect[] = [];
  if (Array.isArray(sample)) {
    attempts.push({
      table: "youtube_channels",
      columns: "*",
      head: true,
      notEq: { [column]: "{}" },
    });
  } else {
    attempts.push({
      table: "youtube_channels",
      columns: "*",
      head: true,
      notNull: [column],
      notEq: { [column]: "" },
    });
    attempts.push({
      table: "youtube_channels",
      columns: "*",
      head: true,
      notEq: { [column]: "{}" },
    });
  }
  attempts.push({
    table: "youtube_channels",
    columns: "*",
    head: true,
    notNull: [column],
  });
  let approximate = false;
  for (let index = 0; index < attempts.length; index += 1) {
    const result = await db.select(attempts[index]);
    if (!result.error) {
      if (index === attempts.length - 1 && attempts.length > 1) approximate = true;
      return { column, count: asCount(result), approximate };
    }
  }
  return { column, count: 0, approximate: true };
}

async function loadYoutube(db: OpsDb, now: Date): Promise<OpsYoutubeSection> {
  const empty: OpsYoutubeSection = {
    error: null,
    available: false,
    unavailableReason: null,
    total: null,
    passedMarketFilter: null,
    added24h: null,
    added7d: null,
    emails: [],
    emailNote: null,
    queueAvailable: false,
    queueUnavailableReason: null,
    queueByStatus: [],
  };
  const sample = await db.select({ table: "youtube_channels", columns: "*", limit: 1 });
  let channels: OpsYoutubeSection = { ...empty };
  if (sample.error && isMissingRelation(sample.error)) {
    channels = {
      ...empty,
      unavailableReason: "youtube_channels is not in this database yet.",
    };
  } else if (sample.error) {
    channels = { ...empty, error: "Could not read the YouTube library.", unavailableReason: "Could not read the YouTube library." };
  } else {
    const [total, passed, added24h, added7d, columns] = await Promise.all([
      countHead(db, { table: "youtube_channels" }),
      countHead(db, { table: "youtube_channels", eq: { passed_market_filter: true } }),
      countHead(db, { table: "youtube_channels", gte: { created_at: isoDaysAgo(now, 1) } }),
      countHead(db, { table: "youtube_channels", gte: { created_at: isoDaysAgo(now, 7) } }),
      emailColumns(db, sample.rows[0]),
    ]);
    const failed = [total, passed, added24h, added7d].find((item) => item.error);
    const emails: OpsEmailStat[] = [];
    for (const column of columns) {
      emails.push(await countEmail(db, column, sample.rows[0]?.[column]));
    }
    channels = {
      ...empty,
      error: failed ? "Could not read YouTube library counts." : null,
      available: true,
      total: total.count,
      passedMarketFilter: passed.count,
      added24h: added24h.count,
      added7d: added7d.count,
      emails,
      emailNote:
        columns.length === 0 ? "No email column on youtube_channels." : null,
    };
  }

  const queueSample = await db.select({
    table: "youtube_pull_queue",
    columns: "status",
    limit: 1,
  });
  if (queueSample.error && isMissingRelation(queueSample.error)) {
    return {
      ...channels,
      queueUnavailableReason: "youtube_pull_queue is not in this database yet.",
    };
  }
  if (queueSample.error) {
    return { ...channels, queueUnavailableReason: "Could not read the YouTube pull queue." };
  }
  const statuses = await readPages(db, { table: "youtube_pull_queue", columns: "status" });
  if (statuses.error) {
    return { ...channels, queueAvailable: false, queueUnavailableReason: "Could not read the YouTube pull queue." };
  }
  const tally = new Map<string, number>();
  for (const row of statuses.rows) {
    const status = text(row.status) || "unknown";
    tally.set(status, (tally.get(status) ?? 0) + 1);
  }
  const preferred = ["pending", "done", "error"];
  const queueByStatus = [
    ...preferred.map((status) => ({ key: status, count: tally.get(status) ?? 0 })),
    ...[...tally.keys()]
      .filter((status) => !preferred.includes(status))
      .sort()
      .map((status) => ({ key: status, count: tally.get(status) ?? 0 })),
  ];
  return {
    ...channels,
    queueAvailable: true,
    queueByStatus,
    queueUnavailableReason: statuses.truncated ? "Queue counts cover the first 5,000 rows." : null,
  };
}

function queueValue(value: unknown): string {
  return redactOpsText(text(value)).slice(0, 80);
}

async function loadActivity(db: OpsDb): Promise<OpsActivitySection> {
  const [events, failed, queueErrors, recentDone] = await Promise.all([
    db.select({
      table: "domain_events",
      columns: "id, event_type, entity_type, entity_id, created_at",
      or: ERROR_EVENT_OR,
      order: { column: "created_at", ascending: false },
      limit: 20,
    }),
    db.select({
      table: "payments",
      columns: "id, created_at",
      eq: { status: "failed" },
      order: { column: "created_at", ascending: false },
      limit: 10,
    }),
    db.select({
      table: "youtube_pull_queue",
      columns: "id, kind, value, status, attempts, last_error, created_at",
      eq: { status: "error" },
      order: { column: "created_at", ascending: false },
      limit: 15,
    }),
    db.select({
      table: "youtube_pull_queue",
      columns: "id, kind, value, status, created_at",
      eq: { status: "done" },
      order: { column: "created_at", ascending: false },
      limit: 8,
    }),
  ]);
  const queueMissing =
    (queueErrors.error && isMissingRelation(queueErrors.error)) ||
    (recentDone.error && isMissingRelation(recentDone.error));
  const notes: string[] = [];
  if (events.error) notes.push("Could not read recent error events.");
  if (failed.error) notes.push("Could not read failed payments.");
  if (!queueMissing && (queueErrors.error || recentDone.error)) {
    notes.push("Could not read YouTube pull jobs.");
  }
  return {
    error: notes.length > 0 ? notes.join(" ") : null,
    events: events.error
      ? []
      : events.rows.map((row) => ({
          id: text(row.id),
          eventType: text(row.event_type),
          entityType: text(row.entity_type),
          entityId: text(row.entity_id),
          createdAt: text(row.created_at),
        })),
    failedPayments: failed.error
      ? []
      : failed.rows.map((row) => ({ id: text(row.id), createdAt: text(row.created_at) })),
    queueErrors:
      queueErrors.error || queueMissing
        ? []
        : queueErrors.rows.map((row) => ({
            id: text(row.id),
            createdAt: text(row.created_at),
            kind: text(row.kind),
            value: queueValue(row.value),
            attempts: asCents(row.attempts) ?? 0,
            lastError: redactOpsText(text(row.last_error)) || "No error text",
          })),
    recentDone:
      recentDone.error || queueMissing
        ? []
        : recentDone.rows.map((row) => ({
            id: text(row.id),
            createdAt: text(row.created_at),
            kind: text(row.kind),
            value: queueValue(row.value),
            status: text(row.status),
          })),
  };
}

export async function loadOpsDashboard(
  db: OpsDb,
  filters: OpsFilters,
  now: Date,
): Promise<OpsDashboardData> {
  const [accounts, campaigns, deals, fees, youtube, activity] = await Promise.all([
    loadAccounts(db, filters, now).catch(() => failedAccounts()),
    loadCampaigns(db, filters).catch(() => failedCampaigns()),
    loadDeals(db, filters).catch(() => failedDeals()),
    loadFees(db, now).catch(() => ({ error: "Could not read platform fees.", summary: null })),
    loadYoutube(db, now).catch(() => failedYoutube()),
    loadActivity(db).catch(() => failedActivity()),
  ]);
  return { generatedAt: now.toISOString(), accounts, campaigns, deals, fees, youtube, activity };
}

function failedAccounts(): OpsAccountsSection {
  return {
    error: "Could not read account counts.",
    listError: "Could not read the account list.",
    counts: [],
    signups24h: null,
    signups7d: null,
    matched: null,
    rows: [],
  };
}

function failedCampaigns(): OpsCampaignsSection {
  return {
    error: "Could not read campaign counts.",
    listError: "Could not read the campaign list.",
    detailNote: null,
    counts: [],
    active: null,
    matched: null,
    rows: [],
  };
}

function failedDeals(): OpsDealsSection {
  return {
    error: "Could not read deal counts.",
    listError: "Could not read the deal list.",
    detailNote: null,
    counts: [],
    active: null,
    matched: null,
    rows: [],
  };
}

function failedYoutube(): OpsYoutubeSection {
  return {
    error: "Could not read the YouTube library.",
    available: false,
    unavailableReason: "Could not read the YouTube library.",
    total: null,
    passedMarketFilter: null,
    added24h: null,
    added7d: null,
    emails: [],
    emailNote: null,
    queueAvailable: false,
    queueUnavailableReason: "Could not read the YouTube pull queue.",
    queueByStatus: [],
  };
}

function failedActivity(): OpsActivitySection {
  return {
    error: "Could not read recent errors.",
    events: [],
    failedPayments: [],
    queueErrors: [],
    recentDone: [],
  };
}
