#!/usr/bin/env npx tsx
// ============================================================
// BACKFILL: insertion_orders + io_line_items for DocuSign-flow deals.
//
// Wave 12's send-to-docusign rendered the IO PDF in-memory and never
// persisted IO rows, so deals signed through DocuSign have no
// insertion_orders/io_line_items — which blocks mark-delivered and
// chargeForEpisode. The route now persists on send; this script heals the
// deals whose envelopes predate that fix.
//
// Reconstruction is FAITHFUL TO THE SIGNED DOCUMENT, not to current data:
// every send logged an io.generated domain event carrying the exact
// io_number, total_gross, total_net, and post_dates rendered onto the PDF.
// We use the io.generated event immediately preceding the deal's
// io.sent_for_signature event (the same request that created the envelope) —
// NOT the latest render, since deals can be re-rendered after sending.
// Current show_profiles.audience_size may have drifted; the event payload
// has not.
//
// Run:  npx tsx scripts/backfill-io-rows-docusign-deals.ts          (dry-run)
//       npx tsx scripts/backfill-io-rows-docusign-deals.ts --apply  (writes)
//
// Dry-run is the default and prints the full per-deal reconstruction.
// --apply requires founder review of the dry-run report first.
// Inserts go through lib/io/persist-io.ts (same guards/idempotency as the
// live route) with status/sent_at/signed_at overrides for historical truth.
// ============================================================

// Dev-mode env loading is deliberate: .env.local (real keys) must win over
// .env.production.local, a `vercel env pull` artifact whose sensitive values
// are redacted to the literal string "[SENSITIVE]".
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), true);

const APPLY = process.argv.includes("--apply");
const round2 = (n: number) => Math.round(n * 100) / 100;

interface EventRow {
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

async function main(): Promise<void> {
  // Dynamic imports: lib/supabase/admin.ts builds its client from env at
  // module scope, so env must be loaded before these modules are.
  const { supabaseAdmin } = await import("../lib/supabase/admin");
  const { persistIoForDeal } = await import("../lib/io/persist-io");
  const { brandNameFromProfile } = await import("../lib/brand/display-name");
  const { dealIoNumber } = await import("../lib/io/io-number");
  type Draft = import("../lib/pdf/io-generator").IoLineItemDraft;

  console.log(`=== IO-row backfill for DocuSign deals — ${APPLY ? "APPLY" : "DRY-RUN"} ===\n`);

  // ---- Candidates: envelope exists, no IO row for the deal ----
  const { data: deals, error: dealsErr } = await supabaseAdmin
    .from("deals")
    .select(
      "id, status, docusign_envelope_id, agreed_cpm, agreed_episode_count, agreed_placement, show_signed_at, brand_signed_at, brand_id, brand_profile_id, show_profile_id"
    )
    .not("docusign_envelope_id", "is", null);
  if (dealsErr) throw new Error(`deals query: ${dealsErr.message}`);

  const { data: ios, error: iosErr } = await supabaseAdmin
    .from("insertion_orders")
    .select("deal_id");
  if (iosErr) throw new Error(`insertion_orders query: ${iosErr.message}`);
  const dealsWithIo = new Set((ios ?? []).map((r) => r.deal_id));

  const candidates = (deals ?? []).filter((d) => !dealsWithIo.has(d.id));
  console.log(
    `Deals with a DocuSign envelope: ${deals?.length ?? 0}; missing IO rows: ${candidates.length}\n`
  );

  let ok = 0;
  let failed = 0;

  for (const deal of candidates) {
    const tag = `deal ${deal.id.slice(0, 8)} (${deal.status})`;
    try {
      // ---- Pick the event pair that matches the signed document ----
      const { data: evts, error: evErr } = await supabaseAdmin
        .from("domain_events")
        .select("event_type, payload, created_at")
        .eq("entity_id", deal.id)
        .in("event_type", ["io.generated", "io.sent_for_signature"])
        .order("created_at", { ascending: true });
      if (evErr) throw new Error(`events query: ${evErr.message}`);
      const events = (evts ?? []) as EventRow[];

      const sentEvt = events.find((e) => e.event_type === "io.sent_for_signature");
      if (!sentEvt) throw new Error("no io.sent_for_signature event");
      const generated = events.filter((e) => e.event_type === "io.generated");
      if (generated.length === 0) throw new Error("no io.generated event");
      const genEvt =
        [...generated]
          .reverse()
          .find((e) => e.created_at <= sentEvt.created_at) ?? generated[0];

      const ioNumber = String(genEvt.payload.io_number ?? "");
      const totalGross = Number(genEvt.payload.total_gross);
      const totalNet = Number(genEvt.payload.total_net);
      const postDates = (genEvt.payload.post_dates ?? []) as string[];
      const expectedIoNumber = dealIoNumber(deal.id);
      if (ioNumber !== expectedIoNumber) {
        throw new Error(
          `event io_number ${ioNumber} != deal-derived ${expectedIoNumber}`
        );
      }
      if (!Number.isFinite(totalGross) || totalGross <= 0) {
        throw new Error(`bad total_gross in event payload: ${genEvt.payload.total_gross}`);
      }

      const episodes = deal.agreed_episode_count as number;
      const cpm = deal.agreed_cpm as number;
      if (!episodes || episodes <= 0) throw new Error(`bad agreed_episode_count: ${episodes}`);
      if (!cpm || cpm <= 0) throw new Error(`bad agreed_cpm: ${cpm}`);
      if (postDates.length !== episodes) {
        throw new Error(
          `post_dates count ${postDates.length} != agreed_episode_count ${episodes}`
        );
      }

      // ---- Reconstruct per-episode economics from the signed totals ----
      const grossRate = round2(totalGross / episodes);
      if (Math.abs(grossRate * episodes - totalGross) > 0.02) {
        throw new Error(
          `reconstruction drift: ${grossRate} x ${episodes} = ${grossRate * episodes} vs total_gross ${totalGross}`
        );
      }
      const guaranteedDownloads = Math.round((grossRate / cpm) * 1000);
      if (Math.abs(round2((guaranteedDownloads / 1000) * cpm) - grossRate) > 0.01) {
        throw new Error(
          `downloads round-trip drift: ${guaranteedDownloads} @ $${cpm} CPM != $${grossRate}`
        );
      }

      // ---- Parties ----
      if (!deal.show_profile_id) throw new Error("deal has no show_profile_id");
      const { data: sp, error: spErr } = await supabaseAdmin
        .from("show_profiles")
        .select("id, user_id, show_name, platform, ad_read_types")
        .eq("id", deal.show_profile_id)
        .single();
      if (spErr || !sp) throw new Error(`show_profile: ${spErr?.message ?? "missing"}`);
      const { data: showUser, error: suErr } = await supabaseAdmin
        .from("profiles")
        .select("email, full_name")
        .eq("id", sp.user_id)
        .single();
      if (suErr || !showUser) throw new Error(`show user profile: ${suErr?.message ?? "missing"}`);
      const { data: bp, error: bpErr } = await supabaseAdmin
        .from("brand_profiles")
        .select("*")
        .eq("id", deal.brand_profile_id)
        .single();
      if (bpErr || !bp) throw new Error(`brand_profile: ${bpErr?.message ?? "missing"}`);
      const { data: brandUser } = await supabaseAdmin
        .from("profiles")
        .select("email")
        .eq("id", deal.brand_id)
        .maybeSingle();

      const publisherName = (sp.show_name as string) ?? "Publisher";
      const advertiserName = brandNameFromProfile(bp) ?? "Advertiser";
      const adReadTypes = (sp.ad_read_types ?? []) as string[];

      const lineItems: Draft[] = postDates.map((postDate) => ({
        format: sp.platform === "youtube" ? "youtube" : "podcast",
        post_date: postDate,
        guaranteed_downloads: guaranteedDownloads,
        show_name: publisherName,
        placement: deal.agreed_placement,
        is_scripted: adReadTypes.includes("scripted"),
        is_personal_experience: adReadTypes.includes("personal_experience"),
        reader_type: "host_read",
        content_type: "evergreen",
        pixel_required: false,
        gross_rate: grossRate,
        gross_cpm: cpm,
        price_type: "cpm",
        net_due: grossRate,
        verified: false,
        make_good_triggered: false,
      }));

      // ---- Historical status mapping ----
      const statusMap: Record<string, string> = {
        planning: "sent",
        brand_signed: "sent",
        show_signed: "signed",
        delivering: "signed",
        live: "active",
        completed: "completed",
        cancelled: "cancelled",
      };
      const ioStatus = statusMap[deal.status as string];
      if (!ioStatus) throw new Error(`unmapped deal status: ${deal.status}`);
      const signedAt =
        ioStatus === "signed" || ioStatus === "active" || ioStatus === "completed"
          ? ((deal.show_signed_at as string | null) ?? null)
          : null;

      // ---- Report ----
      console.log(`--- ${tag}`);
      console.log(`    io_number:   ${ioNumber}  (event of ${genEvt.created_at})`);
      console.log(`    status map:  ${deal.status} -> ${ioStatus}${signedAt ? ` (signed_at ${signedAt})` : ""}`);
      console.log(`    sent_at:     ${sentEvt.created_at}`);
      console.log(`    parties:     ${advertiserName} <-> ${publisherName} (${showUser.email})`);
      console.log(`    economics:   ${episodes} x $${grossRate.toFixed(2)} @ $${cpm} CPM, ${guaranteedDownloads.toLocaleString()} downloads/ep, total $${totalGross}`);
      console.log(`    post_dates:  ${postDates.join(", ")}`);

      if (APPLY) {
        const result = await persistIoForDeal({
          dealId: deal.id,
          rendered: {
            ioNumber,
            totalGross,
            totalNet,
            totalDownloads: guaranteedDownloads * episodes,
            lineItems,
          },
          contacts: {
            advertiserName,
            advertiserContactEmail: (brandUser?.email as string) ?? null,
            publisherName,
            publisherContactName: (showUser.full_name as string) ?? publisherName,
            publisherContactEmail: showUser.email as string,
          },
          actorId: null,
          source: "backfill",
          overrides: {
            status: ioStatus as import("../lib/data/types").IOStatus,
            sentAt: sentEvt.created_at,
            signedAt,
          },
        });
        // Introspect: never trust the write without reading it back.
        const { count } = await supabaseAdmin
          .from("io_line_items")
          .select("id", { count: "exact", head: true })
          .eq("io_id", result.ioId);
        console.log(
          `    APPLIED:     io ${result.ioId} created=${result.created} line_items=${count}`
        );
        if (count !== episodes) throw new Error(`post-apply count ${count} != ${episodes}`);
      }
      console.log("");
      ok++;
    } catch (err) {
      failed++;
      console.error(`--- ${tag} FAILED: ${err instanceof Error ? err.message : err}\n`);
    }
  }

  console.log(`=== ${APPLY ? "APPLY" : "DRY-RUN"} complete: ${ok} ok, ${failed} failed ===`);
  if (!APPLY) {
    console.log("No writes performed. Re-run with --apply after reviewing the report.");
  }
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
