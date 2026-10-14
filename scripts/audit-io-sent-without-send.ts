#!/usr/bin/env npx tsx
// Read-only. Lists live deals in io_sent that have no sent IO and no
// DocuSign envelope. Does not update or delete any row.
//
//   npx tsx scripts/audit-io-sent-without-send.ts

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface IoRow {
  id: string;
  sent_at: string | null;
  status: string | null;
  io_number: string | null;
}

interface DealRow {
  id: string;
  created_at: string;
  campaign_id: string | null;
  show_id: string | null;
  docusign_envelope_id: string | null;
  insertion_orders: IoRow[] | null;
}

async function fetchUnsentCandidates(): Promise<DealRow[]> {
  const pageSize = 1000;
  const rows: DealRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("deals")
      .select(
        "id, created_at, campaign_id, show_id, docusign_envelope_id, insertion_orders(id, sent_at, status, io_number)"
      )
      .eq("status", "io_sent")
      .is("docusign_envelope_id", null)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as DealRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function lacksRealSend(deal: DealRow): boolean {
  const ios = deal.insertion_orders ?? [];
  return !ios.some((io) => Boolean(io.sent_at));
}

async function main() {
  const candidates = await fetchUnsentCandidates();
  const flagged = candidates.filter(lacksRealSend);
  console.log(`io_sent with no envelope and no IO sent_at: ${flagged.length}`);
  for (const deal of flagged) {
    const ios = deal.insertion_orders ?? [];
    console.log(
      [
        deal.id,
        deal.created_at,
        `campaign=${deal.campaign_id ?? "none"}`,
        `ios=${ios.length}`,
        ios.map((io) => `${io.io_number ?? io.id}:${io.status ?? "?"}`).join(",") || "no-io",
      ].join("  ")
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
