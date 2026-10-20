#!/usr/bin/env npx tsx
// Dry-run inventory of old test data, with an opt-in delete.
//
// Default is read-only. Nothing is deleted, and no domain event is written,
// unless --execute is passed with --confirm=<N> where N is the dry-run
// delete_count from this same database state.
//
//   npx tsx scripts/cleanup-test-data.ts
//   npx tsx scripts/cleanup-test-data.ts --execute --confirm=<delete_count>
//
// --execute calls public.cleanup_test_data (migration 043). That function
// re-checks the proof account, non-test owners, Stripe charges, and payouts,
// then deletes children before parents and writes one domain_events row per
// batch, all in one transaction. Paste
// supabase/migrations/043_cleanup_test_data.sql before the first --execute.
//
// Never deletes auth.users or profiles. Never calls Stripe, Resend, or
// DocuSign. A payout row, a Stripe charge, a sent/paid invoice, a non-test
// owner, chris+brand1@taylslate.com, and deal
// ccb7db74-08bb-41d7-aa3a-dbc37daa9b55 stay.
//
// Test profiles are chris+…@taylslate.com except that proof account. Shows are
// removed only when the name starts with [SEED] or the row was materialized
// for an outreach already in the plan. Podscan catalog rows tagged
// data_sources seed are left in place.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const PROOF_ACCOUNT_EMAIL = "chris+brand1@taylslate.com";
export const PROOF_ACCOUNT_USER_ID = "052f916b-e4a1-4f3e-8816-3cd53dbf7ccc";
export const PROOF_DEAL_ID = "ccb7db74-08bb-41d7-aa3a-dbc37daa9b55";

const HOUSE_TEST_EMAIL = /^chris\+[^\s@]+@taylslate\.com$/i;
const SEED_TOKEN = /^(seed-|pending_seed_)/;
const SEED_OUTREACH_EMAIL = /^chris\+seedotr-[^\s@]+@taylslate\.com$/i;
const CHARGE_STATUSES = new Set([
  "succeeded",
  "completed",
  "processing",
  "refunded",
  "disputed",
]);

export const DELETION_ORDER = [
  "invoice_line_item",
  "payment",
  "invoice",
  "aircheck",
  "io_line_item",
  "insertion_order",
  "deal",
  "outreach",
  "campaign",
  "show",
] as const;

export type CleanupRowType = (typeof DELETION_ORDER)[number];

export interface ProfileRow {
  id: string;
  email: string | null;
  created_at: string;
}

export interface BrandProfileRow {
  id: string;
  user_id: string;
}

export interface ShowProfileRow {
  id: string;
  user_id: string;
}

export interface CampaignRow {
  id: string;
  user_id: string;
  name: string;
  brief: unknown;
  created_at: string;
}

export interface DealRow {
  id: string;
  created_at: string;
  status: string;
  campaign_id: string | null;
  show_id: string;
  brand_id: string;
  agent_id: string | null;
  agency_id: string | null;
  brand_profile_id: string | null;
  show_profile_id: string | null;
  outreach_id: string | null;
  docusign_envelope_id: string | null;
}

export interface ShowRow {
  id: string;
  name: string;
  slug: string | null;
  data_sources: string[] | null;
  created_at: string;
}

export interface OutreachRow {
  id: string;
  brand_profile_id: string;
  campaign_id: string;
  show_id: string | null;
  show_name: string;
  token: string;
  sent_to_email: string;
  created_at: string;
}

export interface InsertionOrderRow {
  id: string;
  deal_id: string;
  sent_at: string | null;
  status: string | null;
  created_at: string;
}

export interface LineItemRow {
  id: string;
  io_id: string;
  created_at: string;
}

export interface InvoiceRow {
  id: string;
  io_id: string;
  status: string;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface InvoiceLineItemRow {
  id: string;
  invoice_id: string;
  io_line_item_id: string;
  created_at: string;
}

export interface PaymentRow {
  id: string;
  deal_id: string | null;
  io_line_item_id: string | null;
  invoice_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_payment_id: string | null;
  status: string;
  charged_at: string | null;
  amount_charged_cents: number | null;
  created_at: string;
}

export interface PayoutRow {
  id: string;
  payment_id: string;
  stripe_transfer_id: string | null;
  transferred_at: string | null;
  created_at: string;
}

export interface AircheckRow {
  id: string;
  io_line_item_id: string;
  created_at: string;
}

export interface SeedEventRow {
  event_type: string;
  payload: unknown;
}

export interface CleanupSnapshot {
  profiles: ProfileRow[];
  brandProfiles: BrandProfileRow[];
  // Show-side link only. A real show profile does not make a deal test data
  // and does not protect a test brand's deal.
  showProfiles: ShowProfileRow[];
  campaigns: CampaignRow[];
  deals: DealRow[];
  shows: ShowRow[];
  outreaches: OutreachRow[];
  insertionOrders: InsertionOrderRow[];
  lineItems: LineItemRow[];
  invoices: InvoiceRow[];
  invoiceLineItems: InvoiceLineItemRow[];
  payments: PaymentRow[];
  payouts: PayoutRow[];
  airchecks: AircheckRow[];
  seedEvents: SeedEventRow[];
}

export interface PlannedRow {
  id: string;
  type: CleanupRowType;
  owner: string;
  ownerProfileId: string | null;
  created_at: string;
  reasons: string[];
}

export interface ExcludedRow {
  id: string;
  type: CleanupRowType;
  owner: string;
  created_at: string;
  matched: string[];
  excludedBecause: string;
}

export interface CleanupBatch {
  type: CleanupRowType;
  ids: string[];
}

export interface CleanupPlan {
  delete: PlannedRow[];
  excluded: ExcludedRow[];
  batches: CleanupBatch[];
}

export interface CleanupArgs {
  execute: boolean;
  confirm: number | null;
}

export interface BatchEvent {
  eventType: "admin.test_data_cleanup";
  entityType: CleanupRowType;
  entityId: string;
  payload: {
    batch: CleanupRowType;
    ids: string[];
    count: number;
    dry_run: false;
  };
}

export function isHouseTestEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return HOUSE_TEST_EMAIL.test(email.trim());
}

export function isProofAccount(row: {
  id?: string | null;
  email?: string | null;
}): boolean {
  if (row.id && row.id === PROOF_ACCOUNT_USER_ID) return true;
  return (row.email ?? "").trim().toLowerCase() === PROOF_ACCOUNT_EMAIL;
}

/** House chris+taylslate aliases, except the managed proof account. */
export function isTestOrSeedProfile(profile: {
  id: string;
  email: string | null;
}): boolean {
  if (isProofAccount(profile)) return false;
  return isHouseTestEmail(profile.email);
}

export function hasSeedName(name: string | null | undefined): boolean {
  return (name ?? "").trimStart().startsWith("[SEED]");
}

export function briefIsSeeded(brief: unknown): boolean {
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) return false;
  return (brief as Record<string, unknown>).seeded === true;
}

export function isSeedOutreachToken(token: string | null | undefined): boolean {
  return SEED_TOKEN.test(token ?? "");
}

export function isSeedOutreachEmail(email: string | null | undefined): boolean {
  return SEED_OUTREACH_EMAIL.test((email ?? "").trim());
}

export function paymentIsStripeCharge(payment: PaymentRow): boolean {
  if (present(payment.stripe_payment_intent_id)) return true;
  if (present(payment.stripe_payment_id)) return true;
  if (payment.charged_at) return true;
  if ((payment.amount_charged_cents ?? 0) > 0) return true;
  return CHARGE_STATUSES.has(payment.status);
}

/** A payout row is a transfer record. It blocks the parent even before Stripe stamps an id. */
export function payoutBlocksDeletion(payout: PayoutRow): boolean {
  return Boolean(
    payout.id ||
      present(payout.stripe_transfer_id) ||
      payout.transferred_at
  );
}

export function invoiceBlocksDeletion(invoice: InvoiceRow): boolean {
  if (invoice.paid_at || invoice.sent_at) return true;
  return invoice.status === "paid" || invoice.status === "sent";
}

export function isStaleIoSent(
  deal: Pick<DealRow, "status" | "docusign_envelope_id">,
  insertionOrders: Pick<InsertionOrderRow, "sent_at">[]
): boolean {
  if (deal.status !== "io_sent") return false;
  if (present(deal.docusign_envelope_id)) return false;
  return !insertionOrders.some((io) => Boolean(io.sent_at));
}

export function parseCleanupArgs(argv: string[]): CleanupArgs {
  let execute = false;
  let confirm: number | null = null;
  for (const arg of argv) {
    if (arg === "--execute") {
      if (execute) throw new Error("duplicate --execute");
      execute = true;
      continue;
    }
    if (arg === "--dry-run") continue;
    const match = /^--confirm=(\d+)$/.exec(arg);
    if (match) {
      if (confirm !== null) throw new Error("duplicate --confirm");
      confirm = Number(match[1]);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return { execute, confirm };
}

export function confirmGate(
  args: CleanupArgs,
  deleteCount: number
): { proceed: boolean; message: string } {
  const command = `npx tsx scripts/cleanup-test-data.ts --execute --confirm=${deleteCount}`;
  if (!args.execute) {
    return {
      proceed: false,
      message:
        `dry run only — ${deleteCount} row(s) would be deleted. ` +
        `Nothing was written. To delete this exact set: ${command}`,
    };
  }
  if (args.confirm === null) {
    return {
      proceed: false,
      message: `--execute requires --confirm=${deleteCount} (the dry-run delete_count).`,
    };
  }
  if (args.confirm !== deleteCount) {
    return {
      proceed: false,
      message:
        `--confirm=${args.confirm} does not match delete_count ${deleteCount}. ` +
        `Nothing was written. Re-run the dry run and pass that count.`,
    };
  }
  return {
    proceed: true,
    message: `confirm ${deleteCount} matches. Deleting in one transaction.`,
  };
}

export function domainEventsForBatches(batches: CleanupBatch[]): BatchEvent[] {
  return batches.map((batch) => ({
    eventType: "admin.test_data_cleanup",
    entityType: batch.type,
    entityId: batch.ids[0],
    payload: {
      batch: batch.type,
      ids: batch.ids,
      count: batch.ids.length,
      dry_run: false,
    },
  }));
}

export function planCleanup(snapshot: CleanupSnapshot): CleanupPlan {
  const profilesById = new Map(snapshot.profiles.map((row) => [row.id, row]));
  const brandProfilesById = new Map(
    snapshot.brandProfiles.map((row) => [row.id, row])
  );
  const campaignsById = new Map(snapshot.campaigns.map((row) => [row.id, row]));
  const dealsById = new Map(snapshot.deals.map((row) => [row.id, row]));
  const showsById = new Map(snapshot.shows.map((row) => [row.id, row]));
  const outreachesById = new Map(
    snapshot.outreaches.map((row) => [row.id, row])
  );
  const iosByDeal = groupBy(snapshot.insertionOrders, (row) => row.deal_id);
  const linesByIo = groupBy(snapshot.lineItems, (row) => row.io_id);
  const invoicesByIo = groupBy(snapshot.invoices, (row) => row.io_id);
  const invoicesById = new Map(snapshot.invoices.map((row) => [row.id, row]));
  const iosById = new Map(snapshot.insertionOrders.map((row) => [row.id, row]));

  const seedDealIds = new Set<string>();
  const seedShowIds = new Set<string>();
  const seedCampaignIds = new Set<string>();
  const seedOutreachIds = new Set<string>();
  for (const event of snapshot.seedEvents) {
    if (event.event_type !== "deal.seeded" && event.event_type !== "outreach.seeded") {
      continue;
    }
    addPayloadId(seedDealIds, event.payload, "dealId");
    addPayloadId(seedShowIds, event.payload, "showId");
    addPayloadId(seedCampaignIds, event.payload, "campaignId");
    addPayloadId(seedOutreachIds, event.payload, "outreachId");
  }

  const deleteMap = new Map<string, PlannedRow>();
  const excludeMap = new Map<string, ExcludedRow>();

  function addDelete(row: PlannedRow) {
    const key = `${row.type}:${row.id}`;
    const prev = deleteMap.get(key);
    if (!prev) {
      deleteMap.set(key, { ...row, reasons: unique(row.reasons) });
      return;
    }
    deleteMap.set(key, {
      ...prev,
      reasons: unique([...prev.reasons, ...row.reasons]),
    });
  }

  function addExclude(row: ExcludedRow) {
    const key = `${row.type}:${row.id}`;
    if (deleteMap.has(key)) return;
    if (!excludeMap.has(key)) excludeMap.set(key, row);
  }

  function deleting(type: CleanupRowType, id: string): boolean {
    return deleteMap.has(`${type}:${id}`);
  }

  function dealContext(deal: DealRow) {
    const campaign = deal.campaign_id
      ? campaignsById.get(deal.campaign_id) ?? null
      : null;
    const show = showsById.get(deal.show_id) ?? null;
    const outreach = deal.outreach_id
      ? outreachesById.get(deal.outreach_id) ?? null
      : null;
    const ios = iosByDeal.get(deal.id) ?? [];
    const ioIds = new Set(ios.map((row) => row.id));
    const lines = ios.flatMap((io) => linesByIo.get(io.id) ?? []);
    const lineIds = new Set(lines.map((row) => row.id));
    const invoices = ios.flatMap((io) => invoicesByIo.get(io.id) ?? []);
    const invoiceIds = new Set(invoices.map((row) => row.id));
    const brandProfile = deal.brand_profile_id
      ? brandProfilesById.get(deal.brand_profile_id) ?? null
      : null;
    const ownerIds = unique(
      [
        deal.brand_id,
        deal.agent_id,
        deal.agency_id,
        campaign?.user_id ?? null,
        brandProfile?.user_id ?? null,
      ].filter((id): id is string => Boolean(id))
    );
    const owners = ownerIds
      .map((id) => profilesById.get(id))
      .filter((row): row is ProfileRow => Boolean(row));
    return {
      campaign,
      show,
      outreach,
      ios,
      ioIds,
      lineIds,
      invoices,
      invoiceIds,
      owners,
      ownerIds,
    };
  }

  function paymentsTouching(
    dealId: string | null,
    lineIds: Set<string>,
    invoiceIds: Set<string>
  ): PaymentRow[] {
    return snapshot.payments.filter(
      (payment) =>
        (dealId !== null && payment.deal_id === dealId) ||
        (payment.io_line_item_id !== null && lineIds.has(payment.io_line_item_id)) ||
        (payment.invoice_id !== null && invoiceIds.has(payment.invoice_id))
    );
  }

  function blockForPayments(payments: PaymentRow[]): string | null {
    if (payments.some(paymentIsStripeCharge)) return "stripe_charge";
    const paymentIds = new Set(payments.map((payment) => payment.id));
    if (snapshot.payouts.some((payout) => paymentIds.has(payout.payment_id) && payoutBlocksDeletion(payout))) {
      return "stripe_transfer";
    }
    return null;
  }

  for (const deal of snapshot.deals) {
    const ctx = dealContext(deal);
    const reasons: string[] = [];
    if (isSeededDeal(deal, ctx, seedDealIds, seedOutreachIds, seedShowIds, seedCampaignIds)) {
      reasons.push("seeded_deal");
    }
    if (isStaleIoSent(deal, ctx.ios)) reasons.push("stale_io_sent");
    const allTest = ctx.owners.length > 0 && ctx.owners.every(isTestOrSeedProfile);
    if (allTest) reasons.push("test_or_seed_profile");
    if (reasons.length === 0 && deal.id !== PROOF_DEAL_ID) continue;

    const matched = reasons.length > 0 ? reasons : ["protected_proof_deal"];
    const owner = ownerLabel(ctx.owners, deal.brand_id);
    const payments = paymentsTouching(deal.id, ctx.lineIds, ctx.invoiceIds);
    const money = blockForPayments(payments);
    const settled = ctx.invoices.some(invoiceBlocksDeletion);
    const externalInvoiceLine = snapshot.invoiceLineItems.some((line) => {
      if (!ctx.lineIds.has(line.io_line_item_id)) return false;
      const invoice = invoicesById.get(line.invoice_id);
      return !invoice || !ctx.ioIds.has(invoice.io_id);
    });
    const nonTest = ctx.owners.some(
      (profile) => !isProofAccount(profile) && !isTestOrSeedProfile(profile)
    );

    let excludedBecause: string | null = null;
    if (deal.id === PROOF_DEAL_ID) excludedBecause = "proof_deal";
    else if (
      ctx.ownerIds.includes(PROOF_ACCOUNT_USER_ID) ||
      ctx.owners.some(isProofAccount)
    ) {
      excludedBecause = "proof_account";
    }
    else if (money) excludedBecause = money;
    else if (settled) excludedBecause = "settled_invoice";
    else if (externalInvoiceLine) excludedBecause = "external_invoice_line";
    else if (nonTest) excludedBecause = "non_test_profile";
    else if (!allTest && !reasons.includes("seeded_deal")) {
      excludedBecause = "unresolved_owner";
    }

    if (excludedBecause) {
      addExclude({
        id: deal.id,
        type: "deal",
        owner,
        created_at: deal.created_at,
        matched,
        excludedBecause,
      });
      continue;
    }

    addDelete({
      id: deal.id,
      type: "deal",
      owner,
      ownerProfileId: deal.brand_id,
      created_at: deal.created_at,
      reasons: matched,
    });
  }

  if (dealsById.has(PROOF_DEAL_ID) && deleting("deal", PROOF_DEAL_ID)) {
    throw new Error("refusing to plan deletion of the proof deal");
  }

  for (const io of snapshot.insertionOrders) {
    if (dealsById.has(io.deal_id)) continue;
    const lines = linesByIo.get(io.id) ?? [];
    const lineIds = new Set(lines.map((row) => row.id));
    const invoices = invoicesByIo.get(io.id) ?? [];
    const invoiceIds = new Set(invoices.map((row) => row.id));
    const money = blockForPayments(paymentsTouching(null, lineIds, invoiceIds));
    const settled = invoices.some(invoiceBlocksDeletion);
    const excludedBecause = money ?? (settled ? "settled_invoice" : null);
    if (excludedBecause) {
      addExclude({
        id: io.id,
        type: "insertion_order",
        owner: "none",
        created_at: io.created_at,
        matched: ["orphaned_io"],
        excludedBecause,
      });
      continue;
    }
    addDelete({
      id: io.id,
      type: "insertion_order",
      owner: "none",
      ownerProfileId: null,
      created_at: io.created_at,
      reasons: ["orphaned_io"],
    });
  }

  for (const line of snapshot.lineItems) {
    if (iosById.has(line.io_id)) continue;
    const lineIds = new Set([line.id]);
    const heldByInvoice = snapshot.invoiceLineItems.some(
      (invoiceLine) => invoiceLine.io_line_item_id === line.id
    );
    const money = blockForPayments(paymentsTouching(null, lineIds, new Set()));
    if (money || heldByInvoice) {
      addExclude({
        id: line.id,
        type: "io_line_item",
        owner: "none",
        created_at: line.created_at,
        matched: ["orphaned_line_item"],
        excludedBecause: money ?? "external_invoice_line",
      });
      continue;
    }
    addDelete({
      id: line.id,
      type: "io_line_item",
      owner: "none",
      ownerProfileId: null,
      created_at: line.created_at,
      reasons: ["orphaned_line_item"],
    });
  }

  expandChildren(snapshot, deleteMap, dealsById);

  function outreachOwner(outreach: OutreachRow): ProfileRow | null {
    const brandProfile = brandProfilesById.get(outreach.brand_profile_id);
    if (!brandProfile) return null;
    return profilesById.get(brandProfile.user_id) ?? null;
  }

  function outreachBlock(outreach: OutreachRow): string | null {
    const owner = outreachOwner(outreach);
    if (!owner) return null;
    if (isProofAccount(owner)) return "proof_account";
    if (!isTestOrSeedProfile(owner)) return "non_test_profile";
    return null;
  }

  function outreachIsSeeded(outreach: OutreachRow): boolean {
    if (seedOutreachIds.has(outreach.id)) return true;
    if (hasSeedName(outreach.show_name)) return true;
    if (isSeedOutreachToken(outreach.token)) return true;
    if (isSeedOutreachEmail(outreach.sent_to_email)) return true;
    const show = outreach.show_id ? showsById.get(outreach.show_id) : null;
    if (show && (hasSeedName(show.name) || seedShowIds.has(show.id))) return true;
    return false;
  }

  function reachableDeals(campaignId: string): DealRow[] {
    const ids = new Set<string>();
    const rows: DealRow[] = [];
    for (const deal of snapshot.deals) {
      if (deal.campaign_id === campaignId && !ids.has(deal.id)) {
        ids.add(deal.id);
        rows.push(deal);
      }
    }
    for (const outreach of snapshot.outreaches) {
      if (outreach.campaign_id !== campaignId) continue;
      for (const deal of snapshot.deals) {
        if (deal.outreach_id === outreach.id && !ids.has(deal.id)) {
          ids.add(deal.id);
          rows.push(deal);
        }
      }
    }
    return rows;
  }

  for (const campaign of snapshot.campaigns) {
    const reasons: string[] = [];
    if (
      seedCampaignIds.has(campaign.id) ||
      hasSeedName(campaign.name) ||
      briefIsSeeded(campaign.brief)
    ) {
      reasons.push("seeded_campaign");
    }
    const owner = profilesById.get(campaign.user_id) ?? null;
    if (owner && isTestOrSeedProfile(owner)) reasons.push("test_or_seed_profile");
    if (reasons.length === 0) continue;

    const ownerText = owner?.email ?? campaign.user_id;
    let excludedBecause: string | null = null;
    if (campaign.user_id === PROOF_ACCOUNT_USER_ID || (owner && isProofAccount(owner))) {
      excludedBecause = "proof_account";
    }
    else if (owner && !isTestOrSeedProfile(owner)) excludedBecause = "non_test_profile";
    else if (!owner && !reasons.includes("seeded_campaign")) {
      excludedBecause = "unresolved_owner";
    } else if (reachableDeals(campaign.id).some((deal) => !deleting("deal", deal.id))) {
      excludedBecause = "retained_deal";
    } else {
      const outs = snapshot.outreaches.filter((row) => row.campaign_id === campaign.id);
      excludedBecause = outs.map(outreachBlock).find((reason) => reason) ?? null;
    }

    if (excludedBecause) {
      addExclude({
        id: campaign.id,
        type: "campaign",
        owner: ownerText,
        created_at: campaign.created_at,
        matched: reasons,
        excludedBecause,
      });
      continue;
    }

    addDelete({
      id: campaign.id,
      type: "campaign",
      owner: ownerText,
      ownerProfileId: campaign.user_id,
      created_at: campaign.created_at,
      reasons,
    });
    for (const outreach of snapshot.outreaches) {
      if (outreach.campaign_id !== campaign.id) continue;
      const outreachOwnerRow = outreachOwner(outreach);
      addDelete({
        id: outreach.id,
        type: "outreach",
        owner: outreachOwnerRow?.email ?? outreach.sent_to_email,
        ownerProfileId: outreachOwnerRow?.id ?? null,
        created_at: outreach.created_at,
        reasons: ["child_of_cleanup"],
      });
    }
  }

  for (const outreach of snapshot.outreaches) {
    if (deleting("outreach", outreach.id)) continue;
    if (!outreachIsSeeded(outreach)) continue;
    const owner = outreachOwner(outreach);
    const linked = snapshot.deals.filter((deal) => deal.outreach_id === outreach.id);
    const block = outreachBlock(outreach);
    const retained = linked.some((deal) => !deleting("deal", deal.id));
    if (block || retained) {
      addExclude({
        id: outreach.id,
        type: "outreach",
        owner: owner?.email ?? outreach.sent_to_email,
        created_at: outreach.created_at,
        matched: ["seeded_outreach"],
        excludedBecause: block ?? "retained_deal",
      });
      continue;
    }
    addDelete({
      id: outreach.id,
      type: "outreach",
      owner: owner?.email ?? outreach.sent_to_email,
      ownerProfileId: owner?.id ?? null,
      created_at: outreach.created_at,
      reasons: ["seeded_outreach"],
    });
  }

  for (const show of snapshot.shows) {
    // Catalog imports use data_sources "seed" on real shows. Delete a show
    // only when its name was fabricated or it was materialized for an
    // outreach this plan is already deleting.
    const seeded = hasSeedName(show.name);
    const otr = snapshot.outreaches.some(
      (outreach) =>
        deleting("outreach", outreach.id) &&
        (show.slug ?? "").startsWith(`otr-${outreach.id.slice(0, 8)}-`)
    );
    if (!seeded && !otr) continue;
    const reasons = ["seeded_show"];
    const keptDeal = snapshot.deals.some(
      (deal) => deal.show_id === show.id && !deleting("deal", deal.id)
    );
    const keptOutreach = snapshot.outreaches.some(
      (outreach) =>
        outreach.show_id === show.id && !deleting("outreach", outreach.id)
    );
    if (keptDeal || keptOutreach) {
      addExclude({
        id: show.id,
        type: "show",
        owner: "none",
        created_at: show.created_at,
        matched: reasons,
        excludedBecause: keptDeal ? "retained_deal" : "retained_outreach",
      });
      continue;
    }
    addDelete({
      id: show.id,
      type: "show",
      owner: "none",
      ownerProfileId: null,
      created_at: show.created_at,
      reasons,
    });
  }

  const deleteRows = [...deleteMap.values()].sort(compareRows);
  for (const row of deleteRows) {
    if (row.id === PROOF_DEAL_ID) {
      throw new Error("refusing to plan deletion of the proof deal");
    }
    if (
      row.ownerProfileId === PROOF_ACCOUNT_USER_ID ||
      row.owner.trim().toLowerCase() === PROOF_ACCOUNT_EMAIL
    ) {
      throw new Error("refusing to plan deletion of the proof account's rows");
    }
  }

  const batches: CleanupBatch[] = [];
  for (const type of DELETION_ORDER) {
    const ids = deleteRows.filter((row) => row.type === type).map((row) => row.id);
    if (ids.length > 0) batches.push({ type, ids });
  }

  const excluded = [...excludeMap.values()].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });

  return { delete: deleteRows, excluded, batches };
}

export function formatCleanupReport(plan: CleanupPlan): string {
  const lines: string[] = [];
  lines.push(`delete_count: ${plan.delete.length}`);
  lines.push(`exclude_count: ${plan.excluded.length}`);
  lines.push("confirm_matches: delete_count");
  for (const type of DELETION_ORDER) {
    const count = plan.delete.filter((row) => row.type === type).length;
    if (count > 0) lines.push(`${type}: ${count}`);
  }
  lines.push("");
  lines.push("id\ttype\towner\tcreated_at\treason");
  for (const row of plan.delete) {
    lines.push(
      [row.id, row.type, row.owner, row.created_at, row.reasons.join("|")].join("\t")
    );
  }
  if (plan.excluded.length > 0) {
    lines.push("");
    lines.push("id\ttype\towner\tcreated_at\tmatched\texcluded_because");
    for (const row of plan.excluded) {
      lines.push(
        [
          row.id,
          row.type,
          row.owner,
          row.created_at,
          row.matched.join("|"),
          row.excludedBecause,
        ].join("\t")
      );
    }
  }
  lines.push("");
  lines.push(
    "Profiles and auth users are not deleted. Stripe charges, payouts, sent or paid invoices,"
  );
  lines.push(
    `non-test owners, ${PROOF_ACCOUNT_EMAIL}, and deal ${PROOF_DEAL_ID} are excluded.`
  );
  lines.push(
    "Shows are included only when the name starts with [SEED] or the show was materialized for an outreach in this plan."
  );
  return lines.join("\n");
}

function expandChildren(
  snapshot: CleanupSnapshot,
  deleteMap: Map<string, PlannedRow>,
  dealsById: Map<string, DealRow>
) {
  function has(type: CleanupRowType, id: string): boolean {
    return deleteMap.has(`${type}:${id}`);
  }
  function add(row: PlannedRow) {
    const key = `${row.type}:${row.id}`;
    if (!deleteMap.has(key)) deleteMap.set(key, row);
  }
  function ownerForDeal(dealId: string): { owner: string; ownerProfileId: string | null } {
    const parent = deleteMap.get(`deal:${dealId}`);
    return {
      owner: parent?.owner ?? "none",
      ownerProfileId: parent?.ownerProfileId ?? null,
    };
  }

  for (const io of snapshot.insertionOrders) {
    if (!has("deal", io.deal_id)) continue;
    const parent = ownerForDeal(io.deal_id);
    add({
      id: io.id,
      type: "insertion_order",
      owner: parent.owner,
      ownerProfileId: parent.ownerProfileId,
      created_at: io.created_at,
      reasons: ["child_of_cleanup"],
    });
  }

  const deletedIoIds = new Set(
    [...deleteMap.values()]
      .filter((row) => row.type === "insertion_order")
      .map((row) => row.id)
  );

  for (const line of snapshot.lineItems) {
    if (!deletedIoIds.has(line.io_id)) continue;
    const io = snapshot.insertionOrders.find((row) => row.id === line.io_id);
    const parent = io && dealsById.has(io.deal_id) ? ownerForDeal(io.deal_id) : { owner: "none", ownerProfileId: null };
    add({
      id: line.id,
      type: "io_line_item",
      owner: parent.owner,
      ownerProfileId: parent.ownerProfileId,
      created_at: line.created_at,
      reasons: ["child_of_cleanup"],
    });
  }

  const deletedLineIds = new Set(
    [...deleteMap.values()]
      .filter((row) => row.type === "io_line_item")
      .map((row) => row.id)
  );

  for (const invoice of snapshot.invoices) {
    if (!deletedIoIds.has(invoice.io_id)) continue;
    if (invoiceBlocksDeletion(invoice)) {
      throw new Error(`invariant: settled invoice ${invoice.id} entered the delete plan`);
    }
    const io = snapshot.insertionOrders.find((row) => row.id === invoice.io_id);
    const parent = io ? ownerForDeal(io.deal_id) : { owner: "none", ownerProfileId: null };
    add({
      id: invoice.id,
      type: "invoice",
      owner: parent.owner,
      ownerProfileId: parent.ownerProfileId,
      created_at: invoice.created_at,
      reasons: ["child_of_cleanup"],
    });
  }

  const deletedInvoiceIds = new Set(
    [...deleteMap.values()].filter((row) => row.type === "invoice").map((row) => row.id)
  );

  for (const line of snapshot.invoiceLineItems) {
    if (!deletedInvoiceIds.has(line.invoice_id) && !deletedLineIds.has(line.io_line_item_id)) {
      continue;
    }
    if (deletedLineIds.has(line.io_line_item_id) && !deletedInvoiceIds.has(line.invoice_id)) {
      throw new Error(
        `invariant: invoice line ${line.id} points at a line being deleted and an invoice that is not`
      );
    }
    const invoice = snapshot.invoices.find((row) => row.id === line.invoice_id);
    const io = invoice
      ? snapshot.insertionOrders.find((row) => row.id === invoice.io_id)
      : undefined;
    const parent = io ? ownerForDeal(io.deal_id) : { owner: "none", ownerProfileId: null };
    add({
      id: line.id,
      type: "invoice_line_item",
      owner: parent.owner,
      ownerProfileId: parent.ownerProfileId,
      created_at: line.created_at,
      reasons: ["child_of_cleanup"],
    });
  }

  for (const payment of snapshot.payments) {
    const lineHit =
      payment.io_line_item_id !== null && deletedLineIds.has(payment.io_line_item_id);
    const invoiceHit =
      payment.invoice_id !== null && deletedInvoiceIds.has(payment.invoice_id);
    const dealHit = payment.deal_id !== null && has("deal", payment.deal_id);
    if (!lineHit && !invoiceHit && !dealHit) continue;
    if (paymentIsStripeCharge(payment)) {
      throw new Error(`invariant: stripe charge ${payment.id} entered the delete plan`);
    }
    const dealId = payment.deal_id;
    const parent = dealId ? ownerForDeal(dealId) : { owner: "none", ownerProfileId: null };
    add({
      id: payment.id,
      type: "payment",
      owner: parent.owner,
      ownerProfileId: parent.ownerProfileId,
      created_at: payment.created_at,
      reasons: ["child_of_cleanup"],
    });
  }

  for (const aircheck of snapshot.airchecks) {
    if (!deletedLineIds.has(aircheck.io_line_item_id)) continue;
    const line = snapshot.lineItems.find((row) => row.id === aircheck.io_line_item_id);
    const io = line
      ? snapshot.insertionOrders.find((row) => row.id === line.io_id)
      : undefined;
    const parent = io ? ownerForDeal(io.deal_id) : { owner: "none", ownerProfileId: null };
    add({
      id: aircheck.id,
      type: "aircheck",
      owner: parent.owner,
      ownerProfileId: parent.ownerProfileId,
      created_at: aircheck.created_at,
      reasons: ["child_of_cleanup"],
    });
  }
}

function isSeededDeal(
  deal: DealRow,
  ctx: {
    campaign: CampaignRow | null;
    show: ShowRow | null;
    outreach: OutreachRow | null;
  },
  seedDealIds: Set<string>,
  seedOutreachIds: Set<string>,
  seedShowIds: Set<string>,
  seedCampaignIds: Set<string>
): boolean {
  if (seedDealIds.has(deal.id)) return true;
  if (deal.outreach_id && seedOutreachIds.has(deal.outreach_id)) return true;
  if (seedShowIds.has(deal.show_id)) return true;
  if (deal.campaign_id && seedCampaignIds.has(deal.campaign_id)) return true;
  // data_sources "seed" is also how the Podscan catalog was imported.
  // Only the [SEED] name prefix marks a fabricated show.
  if (ctx.show && hasSeedName(ctx.show.name)) return true;
  if (ctx.campaign && (hasSeedName(ctx.campaign.name) || briefIsSeeded(ctx.campaign.brief))) {
    return true;
  }
  if (!ctx.outreach) return false;
  return (
    hasSeedName(ctx.outreach.show_name) ||
    isSeedOutreachToken(ctx.outreach.token) ||
    isSeedOutreachEmail(ctx.outreach.sent_to_email)
  );
}

function ownerLabel(owners: ProfileRow[], fallbackId: string): string {
  const brand = owners.find((profile) => profile.id === fallbackId);
  if (brand?.email) return brand.email;
  const withEmail = owners.find((profile) => profile.email);
  if (withEmail?.email) return withEmail.email;
  return fallbackId || "none";
}

function present(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const list = map.get(id);
    if (list) list.push(row);
    else map.set(id, [row]);
  }
  return map;
}

function addPayloadId(target: Set<string>, payload: unknown, key: string) {
  if (!payload || typeof payload !== "object") return;
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value === "string" && value.length > 0) target.add(value);
}

function compareRows(a: PlannedRow, b: PlannedRow): number {
  const order = DELETION_ORDER.indexOf(a.type) - DELETION_ORDER.indexOf(b.type);
  if (order !== 0) return order;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

async function main() {
  const args = parseCleanupArgs(process.argv.slice(2));
  const supabase = connect();
  const snapshot = await loadSnapshot(supabase);
  const plan = planCleanup(snapshot);
  console.log(formatCleanupReport(plan));
  const gate = confirmGate(args, plan.delete.length);
  console.log(gate.message);
  if (!gate.proceed) {
    if (args.execute) process.exit(1);
    return;
  }
  if (plan.delete.length === 0) {
    console.log("nothing to delete");
    return;
  }
  const result = await executePlan(supabase, plan);
  console.log(JSON.stringify(result));
}

function connect(): SupabaseClient {
  const envContent = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = value;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return createClient(url, key);
}

async function loadSnapshot(supabase: SupabaseClient): Promise<CleanupSnapshot> {
  const [profiles, brandProfiles, showProfiles, campaigns, deals, shows, outreaches, insertionOrders, lineItems, invoices, invoiceLineItems, payments, payouts, airchecks, seedEvents] =
    await Promise.all([
      fetchAll<ProfileRow>(supabase, "profiles", "id, email, created_at"),
      fetchAll<BrandProfileRow>(supabase, "brand_profiles", "id, user_id"),
      fetchAll<ShowProfileRow>(supabase, "show_profiles", "id, user_id"),
      fetchAll<CampaignRow>(supabase, "campaigns", "id, user_id, name, brief, created_at"),
      fetchAll<DealRow>(
        supabase,
        "deals",
        "id, created_at, status, campaign_id, show_id, brand_id, agent_id, agency_id, brand_profile_id, show_profile_id, outreach_id, docusign_envelope_id"
      ),
      fetchAll<ShowRow>(supabase, "shows", "id, name, slug, data_sources, created_at"),
      fetchAll<OutreachRow>(
        supabase,
        "outreaches",
        "id, brand_profile_id, campaign_id, show_id, show_name, token, sent_to_email, created_at"
      ),
      fetchAll<InsertionOrderRow>(
        supabase,
        "insertion_orders",
        "id, deal_id, sent_at, status, created_at"
      ),
      fetchAll<LineItemRow>(supabase, "io_line_items", "id, io_id, created_at"),
      fetchAll<InvoiceRow>(
        supabase,
        "invoices",
        "id, io_id, status, sent_at, paid_at, created_at"
      ),
      fetchAll<InvoiceLineItemRow>(
        supabase,
        "invoice_line_items",
        "id, invoice_id, io_line_item_id, created_at"
      ),
      fetchAll<PaymentRow>(
        supabase,
        "payments",
        "id, deal_id, io_line_item_id, invoice_id, stripe_payment_intent_id, stripe_payment_id, status, charged_at, amount_charged_cents, created_at"
      ),
      fetchAll<PayoutRow>(
        supabase,
        "payouts",
        "id, payment_id, stripe_transfer_id, transferred_at, created_at"
      ),
      fetchAll<AircheckRow>(supabase, "airchecks", "id, io_line_item_id, created_at"),
      fetchAll<SeedEventRow>(
        supabase,
        "domain_events",
        "id, event_type, payload",
        (query) => query.in("event_type", ["deal.seeded", "outreach.seeded"])
      ),
    ]);
  return {
    profiles,
    brandProfiles,
    showProfiles,
    campaigns,
    deals,
    shows,
    outreaches,
    insertionOrders,
    lineItems,
    invoices,
    invoiceLineItems,
    payments,
    payouts,
    airchecks,
    seedEvents,
  };
}

interface PageQuery {
  order: (column: string, options: { ascending: boolean }) => PageQuery;
  range: (from: number, to: number) => PageQuery;
  in: (column: string, values: string[]) => PageQuery;
  then: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>["then"];
}

async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  refine?: (query: PageQuery) => PageQuery
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    let query = supabase.from(table).select(columns) as unknown as PageQuery;
    query = query.order("id", { ascending: true }).range(from, from + pageSize - 1);
    if (refine) query = refine(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function executePlan(supabase: SupabaseClient, plan: CleanupPlan) {
  const ids = (type: CleanupRowType) =>
    plan.batches.find((batch) => batch.type === type)?.ids ?? [];
  const { data, error } = await supabase.rpc("cleanup_test_data", {
    p_invoice_line_item_ids: ids("invoice_line_item"),
    p_invoice_ids: ids("invoice"),
    p_payment_ids: ids("payment"),
    p_aircheck_ids: ids("aircheck"),
    p_line_item_ids: ids("io_line_item"),
    p_io_ids: ids("insertion_order"),
    p_deal_ids: ids("deal"),
    p_outreach_ids: ids("outreach"),
    p_campaign_ids: ids("campaign"),
    p_show_ids: ids("show"),
    p_expected_count: plan.delete.length,
  });
  if (error) {
    throw new Error(
      `${error.message}\n` +
        "No rows were deleted (the cleanup runs in one transaction).\n" +
        "If the function is missing, paste supabase/migrations/043_cleanup_test_data.sql into the SQL editor first."
    );
  }
  return data;
}

function isDirectRun(): boolean {
  const entry = process.argv[1]?.replace(/\\/g, "/") ?? "";
  return /\/cleanup-test-data\.(ts|js)$/.test(entry);
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
