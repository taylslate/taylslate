#!/usr/bin/env npx tsx
// ============================================================
// SEED SUPABASE
// Run: npx tsx scripts/seed-supabase.ts
// Inserts all seed data from lib/data/seed.ts into Supabase.
// Uses the service role key to bypass RLS.
// ============================================================

import { createClient } from "@supabase/supabase-js";
import {
  profiles,
  shows,
  agentShowRelationships,
  deals,
  insertionOrders,
  invoices,
  campaigns,
} from "../lib/data/seed";

// Load env from .env.local
import { readFileSync } from "fs";
import { resolve } from "path";
const envPath = resolve(process.cwd(), ".env.local");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx);
  const value = trimmed.slice(eqIdx + 1);
  if (!process.env[key]) process.env[key] = value;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function upsert(table: string, data: Record<string, unknown>[]) {
  const { error, count } = await supabase.from(table).upsert(data, { onConflict: "id" });
  if (error) {
    console.error(`  ✗ ${table}: ${error.message}`);
    return false;
  }
  console.log(`  ✓ ${table}: ${data.length} rows`);
  return true;
}

async function seed() {
  console.log("Seeding Supabase...\n");

  // 1. Profiles
  await upsert("profiles", profiles.map((p) => ({
    ...p,
    // Ensure updated_at is set
    updated_at: p.created_at,
  })));

  // 2. Shows — flatten contact object to DB columns
  const showRows = shows.map((s) => {
    const { contact, ...rest } = s;
    return {
      ...rest,
      slug: s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      contact_name: contact.name,
      contact_email: contact.email,
      contact_method: contact.method,
      // agent_id needs to map to a real user — keep the seed IDs for now
      agent_id: s.agent_id || null,
    };
  });
  await upsert("shows", showRows);

  // 3. Agent-Show Relationships
  await upsert("agent_show_relationships", agentShowRelationships as unknown as Record<string, unknown>[]);

  // 4. Campaigns
  await upsert("campaigns", campaigns as unknown as Record<string, unknown>[]);

  // 5. Deals
  await upsert("deals", deals as unknown as Record<string, unknown>[]);

  // 6. Insertion Orders + Line Items
  for (const io of insertionOrders) {
    const { line_items, ...ioFields } = io;

    // Insert IO
    const { error: ioErr } = await supabase
      .from("insertion_orders")
      .upsert(ioFields, { onConflict: "id" });
    if (ioErr) {
      console.error(`  ✗ insertion_orders (${io.io_number}): ${ioErr.message}`);
      continue;
    }
    console.log(`  ✓ insertion_orders: ${io.io_number}`);

    // Insert line items
    const lineItemRows = line_items.map((li) => ({
      ...li,
      io_id: io.id,
    }));
    const { error: liErr } = await supabase
      .from("io_line_items")
      .upsert(lineItemRows, { onConflict: "id" });
    if (liErr) {
      console.error(`  ✗ io_line_items for ${io.io_number}: ${liErr.message}`);
    } else {
      console.log(`  ✓ io_line_items: ${lineItemRows.length} rows for ${io.io_number}`);
    }
  }

  // 7. Invoices + Line Items
  for (const inv of invoices) {
    const { line_items, ...invFields } = inv;

    const { error: invErr } = await supabase
      .from("invoices")
      .upsert(invFields, { onConflict: "id" });
    if (invErr) {
      console.error(`  ✗ invoices (${inv.invoice_number}): ${invErr.message}`);
      continue;
    }
    console.log(`  ✓ invoices: ${inv.invoice_number}`);

    const lineItemRows = line_items.map((li) => ({
      ...li,
      invoice_id: inv.id,
    }));
    const { error: liErr } = await supabase
      .from("invoice_line_items")
      .upsert(lineItemRows, { onConflict: "id" });
    if (liErr) {
      console.error(`  ✗ invoice_line_items for ${inv.invoice_number}: ${liErr.message}`);
    } else {
      console.log(`  ✓ invoice_line_items: ${lineItemRows.length} rows for ${inv.invoice_number}`);
    }
  }

  console.log("\n✅ Seed complete!");
}

seed().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
