#!/usr/bin/env npx tsx
// ============================================================
// PROVE: createEnvelope's SignHere tabs actually land on a REAL io-generator
// IO document — via anchor detection — including across a page break.
//
// Run: npx tsx scripts/verify-docusign-tabs.ts
//
// This is the proof for the anchor-mismatch fix (io-generator now renders the
// SIGNATURE_ANCHORS strings as invisible white text). It does NOT assume — it
// creates real sandbox envelopes from real io-generator PDFs and reads the tabs
// DocuSign actually placed:
//
//   1. SHORT IO (4 episodes)  → signature block on page 1
//   2. LONG  IO (30 episodes) → signature block pushed onto a LATER page
//
// For each, it calls the real createEnvelope, then EnvelopesApi.listTabs for
// recipient 1 (brand) and recipient 2 (show), prints the RAW listTabs JSON, and
// asserts each recipient has a signHere tab with a concrete numeric pageNumber +
// xPosition + yPosition. If an anchor failed to match, DocuSign drops the tab and
// listTabs comes back empty → the assertion FAILS loudly.
//
// The key proof: on the LONG IO, both tabs must report pageNumber > 1 — that is
// anchor detection surviving the page break (a coordinate approach could not).
//
// Cleanup: both envelopes are voided afterward. Touches nothing in Supabase, no
// app config, no Connect/webhook.
// ============================================================

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createRequire } from "node:module";
// tsx runs this as ESM; the DocuSign SDK loader uses (0,eval)("require").
(globalThis as Record<string, unknown>).require ??= createRequire(import.meta.url);

import { generateIoPdfFromDeal } from "../lib/pdf/io-generator";
import { createEnvelope, voidEnvelope } from "../lib/docusign/envelope";
import { getDocuSignClient } from "../lib/docusign/client";
import type {
  Wave12Deal,
  BrandProfile,
  ShowProfile,
  Outreach,
} from "../lib/data/types";

// ---- Fixtures (mirror lib/pdf/io-generator.test.ts) ----
const baseDeal: Wave12Deal = {
  id: "deal-short-0001-aaaa",
  outreach_id: "out-1",
  brand_profile_id: "bp1",
  show_profile_id: "sp1",
  status: "planning",
  agreed_cpm: 28.5,
  agreed_episode_count: 4,
  agreed_placement: "mid-roll",
  agreed_flight_start: "2026-05-01",
  agreed_flight_end: "2026-05-31",
  docusign_envelope_id: null,
  brand_signed_at: null,
  show_signed_at: null,
  signed_io_pdf_url: null,
  signature_certificate_url: null,
  brand_reminder_sent_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  created_at: "2026-04-23T00:00:00Z",
  updated_at: "2026-04-23T00:00:00Z",
};

const baseBrand: BrandProfile = {
  id: "bp1",
  user_id: "u-brand",
  brand_identity: "Aurora Sleep — better mattresses",
  brand_website: "https://aurora.example",
  created_at: "",
  updated_at: "",
};

const baseShow: ShowProfile = {
  id: "sp1",
  user_id: "u-show",
  show_name: "The Daily Briefing",
  audience_size: 12_000,
  episode_cadence: "weekly",
  ad_formats: ["host_read_baked"],
  ad_read_types: ["personal_experience"],
  ad_copy_email: "ads@daily.fm",
  billing_email: "money@daily.fm",
  platform: "podcast",
  created_at: "",
  updated_at: "",
} as ShowProfile;

const baseOutreach: Outreach = {
  id: "out-1",
  brand_profile_id: "bp1",
  campaign_id: "c1",
  show_name: "The Daily Briefing",
  proposed_cpm: 28.5,
  proposed_episode_count: 4,
  proposed_placement: "mid-roll",
  proposed_flight_start: "2026-05-01",
  proposed_flight_end: "2026-05-31",
  pitch_body: "ignored for PDF rendering",
  sent_to_email: "host@daily.fm",
  response_status: "accepted",
  token: "tok",
  created_at: "",
  updated_at: "",
} as Outreach;

// LONG IO: 30 weekly episodes over an 8-month flight → ~30 line-item rows,
// pushing the signature block past page 1.
const longDeal: Wave12Deal = {
  ...baseDeal,
  id: "deal-long-0002-bbbb",
  agreed_episode_count: 30,
  agreed_flight_start: "2026-05-01",
  agreed_flight_end: "2026-12-31",
};

const BRAND = { name: "Chris Taylor (Brand)", email: "chris@taylslate.com" };
const SHOW = { name: "Chris Taylor (Show)", email: "chris+show@taylslate.com" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRec = Record<string, any>;

function countPdfPages(buf: Buffer): number {
  // jsPDF emits one "/Type /Page" (not "/Pages") per page, uncompressed.
  const text = buf.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page(?![s])/g);
  return matches ? matches.length : 0;
}

async function listSignHereTabs(
  envelopeId: string,
  recipientId: string
): Promise<AnyRec[]> {
  const { api, accountId, sdk } = await getDocuSignClient();
  const envelopesApi = new (sdk as AnyRec).EnvelopesApi(api);
  const tabs = await envelopesApi.listTabs(accountId, envelopeId, recipientId);
  return (tabs?.signHereTabs as AnyRec[] | undefined) ?? [];
}

interface TabCheck {
  recipientId: string;
  placed: boolean;
  pageNumber: number | null;
  x: number | null;
  y: number | null;
  raw: AnyRec[];
}

function checkTabs(recipientId: string, signHereTabs: AnyRec[]): TabCheck {
  const t = signHereTabs[0];
  const pageNumber = t?.pageNumber != null ? Number(t.pageNumber) : null;
  const x = t?.xPosition != null ? Number(t.xPosition) : null;
  const y = t?.yPosition != null ? Number(t.yPosition) : null;
  const placed =
    signHereTabs.length > 0 &&
    Number.isFinite(pageNumber) &&
    (pageNumber as number) >= 1 &&
    Number.isFinite(x) &&
    Number.isFinite(y);
  return { recipientId, placed, pageNumber, x, y, raw: signHereTabs };
}

interface CaseResult {
  label: string;
  envelopeId: string;
  pdfPages: number;
  brand: TabCheck;
  show: TabCheck;
}

async function runCase(
  label: string,
  deal: Wave12Deal,
  createdEnvelopeIds: string[]
): Promise<CaseResult> {
  console.log(`\n================ ${label} ================`);
  const rendered = generateIoPdfFromDeal({
    deal,
    brandProfile: baseBrand,
    showProfile: baseShow,
    outreach: baseOutreach,
    brandSigningEmail: BRAND.email,
    showSigningEmail: SHOW.email,
  });
  const pdfPages = countPdfPages(rendered.pdfBuffer);
  console.log(
    `io-generator PDF: ${rendered.pdfBuffer.length} bytes, ${pdfPages} page(s), ${deal.agreed_episode_count} line items.`
  );

  const created = await createEnvelope({
    pdfBuffer: rendered.pdfBuffer,
    documentName: `${rendered.ioNumber}.pdf`,
    emailSubject: `Taylslate — anchor-tab proof (${label})`,
    brand: BRAND,
    show: SHOW,
  });
  // Track immediately so the finally-block cleanup voids it even if listTabs
  // (or the next case) throws before we reach the summary.
  createdEnvelopeIds.push(created.envelopeId);
  console.log(`envelopeId: ${created.envelopeId}`);

  const [brandTabs, showTabs] = await Promise.all([
    listSignHereTabs(created.envelopeId, "1"),
    listSignHereTabs(created.envelopeId, "2"),
  ]);

  console.log(`\n--- RAW listTabs → recipient 1 (brand) signHereTabs ---`);
  console.log(JSON.stringify(brandTabs, null, 2));
  console.log(`\n--- RAW listTabs → recipient 2 (show) signHereTabs ---`);
  console.log(JSON.stringify(showTabs, null, 2));

  const brand = checkTabs("1", brandTabs);
  const show = checkTabs("2", showTabs);

  return { label, envelopeId: created.envelopeId, pdfPages, brand, show };
}

function summarize(r: CaseResult): boolean {
  const line = (c: TabCheck, who: string) =>
    `  ${who} (recipient ${c.recipientId}): placed=${c.placed} page=${c.pageNumber} x=${c.x} y=${c.y}`;
  console.log(`\n[${r.label}] PDF pages=${r.pdfPages}`);
  console.log(line(r.brand, "brand"));
  console.log(line(r.show, "show"));
  const bothPlaced = r.brand.placed && r.show.placed;
  return bothPlaced;
}

async function main(): Promise<void> {
  console.log("=== DocuSign anchor-tab placement proof ===");
  console.log(`DOCUSIGN_ENV = ${process.env.DOCUSIGN_ENV ?? "(unset → sandbox)"}`);

  // Safety: this throwaway script creates real, sent envelopes to hard-coded
  // recipients. Refuse to run against production so a stray DOCUSIGN_ENV can
  // never fire live envelopes.
  const dsEnv = process.env.DOCUSIGN_ENV;
  if (dsEnv && dsEnv !== "sandbox") {
    console.error(
      `\nRefusing to run against DOCUSIGN_ENV="${dsEnv}". This proof harness targets the sandbox only. Unset DOCUSIGN_ENV or set it to "sandbox".`
    );
    process.exit(1);
  }

  // Every envelope id created below is tracked here and voided in `finally`,
  // so a throw mid-run never leaks a live sandbox envelope. (process.exit skips
  // finally — so we exit AFTER the try/finally completes, never inside it.)
  const createdEnvelopeIds: string[] = [];
  let pass = false;
  try {
    const short = await runCase("SHORT IO (4 episodes)", baseDeal, createdEnvelopeIds);
    const long = await runCase(
      "LONG IO (30 episodes, multi-page)",
      longDeal,
      createdEnvelopeIds
    );

    console.log("\n\n================ SUMMARY ================");
    const shortOk = summarize(short);
    const longOk = summarize(long);

    const shortBothPage1 = short.brand.pageNumber === 1 && short.show.pageNumber === 1;
    const longBothPastPage1 =
      (long.brand.pageNumber ?? 0) > 1 &&
      long.show.pageNumber === long.brand.pageNumber;

    console.log("\n================ VERDICT ================");
    console.log(`SHORT: both tabs placed = ${shortOk}; both on page 1 = ${shortBothPage1}`);
    console.log(
      `LONG:  both tabs placed = ${longOk}; both past page 1 (survived page break) = ${longBothPastPage1} (page ${long.brand.pageNumber})`
    );

    pass = shortOk && longOk && longBothPastPage1;
    console.log(`\nOVERALL: ${pass ? "PASS ✅" : "FAIL ❌"}`);
  } finally {
    console.log("\nVoiding created envelopes (cleanup)…");
    for (const id of createdEnvelopeIds) {
      const v = await voidEnvelope(id, "anchor-tab verification cleanup");
      console.log(`  ${id}: voided=${v.ok}${v.reason ? ` (${v.reason})` : ""}`);
    }
  }

  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("\nUnexpected failure:");
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
