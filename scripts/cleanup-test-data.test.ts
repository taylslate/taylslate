import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_ACCOUNTS } from "@/lib/admin/test-accounts";
import {
  DELETION_ORDER,
  PROOF_ACCOUNT_EMAIL,
  PROOF_ACCOUNT_USER_ID,
  PROOF_DEAL_ID,
  type CleanupSnapshot,
  type DealRow,
  confirmGate,
  domainEventsForBatches,
  hasSeedName,
  invoiceBlocksDeletion,
  isHouseTestEmail,
  isProofAccount,
  isStaleIoSent,
  isTestOrSeedProfile,
  parseCleanupArgs,
  paymentIsStripeCharge,
  planCleanup,
  formatCleanupReport,
  type PaymentRow,
  type InvoiceRow,
} from "./cleanup-test-data";

const BRAND_TEST = {
  id: "brand-test",
  email: "chris+brand2@taylslate.com",
  created_at: "2026-01-01T00:00:00.000Z",
};
const SHOW_TEST = {
  id: "show-test",
  email: "chris+show1@taylslate.com",
  created_at: "2026-01-01T00:00:00.000Z",
};
const PROOF = {
  id: PROOF_ACCOUNT_USER_ID,
  email: PROOF_ACCOUNT_EMAIL,
  created_at: "2026-01-01T00:00:00.000Z",
};
const REAL = {
  id: "real-brand",
  email: "buyer@acme.com",
  created_at: "2026-01-01T00:00:00.000Z",
};

function emptySnapshot(): CleanupSnapshot {
  return {
    profiles: [BRAND_TEST, SHOW_TEST, PROOF, REAL],
    brandProfiles: [],
    showProfiles: [],
    campaigns: [],
    deals: [],
    shows: [],
    outreaches: [],
    insertionOrders: [],
    lineItems: [],
    invoices: [],
    invoiceLineItems: [],
    payments: [],
    payouts: [],
    airchecks: [],
    seedEvents: [],
  };
}

function deal(overrides: Partial<DealRow> = {}): DealRow {
  return {
    id: "deal-1",
    created_at: "2026-02-01T00:00:00.000Z",
    status: "planning",
    campaign_id: null,
    show_id: "show-real",
    brand_id: BRAND_TEST.id,
    agent_id: null,
    agency_id: null,
    brand_profile_id: null,
    show_profile_id: null,
    outreach_id: null,
    docusign_envelope_id: null,
    ...overrides,
  };
}

function payment(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: "pay-1",
    deal_id: "deal-1",
    io_line_item_id: null,
    invoice_id: null,
    stripe_payment_intent_id: null,
    stripe_payment_id: null,
    status: "pending",
    charged_at: null,
    amount_charged_cents: null,
    created_at: "2026-02-02T00:00:00.000Z",
    ...overrides,
  };
}

function invoice(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: "inv-1",
    io_id: "io-1",
    status: "draft",
    sent_at: null,
    paid_at: null,
    created_at: "2026-02-03T00:00:00.000Z",
    ...overrides,
  };
}

function idsOf(plan: ReturnType<typeof planCleanup>, type: string): string[] {
  return plan.delete.filter((row) => row.type === type).map((row) => row.id);
}

describe("test-profile matching", () => {
  it("treats chris+ aliases on taylslate.com as house test emails", () => {
    expect(isHouseTestEmail("chris+show1@taylslate.com")).toBe(true);
    expect(isHouseTestEmail("chris+seedotr-ab12@taylslate.com")).toBe(true);
    expect(isHouseTestEmail(" buyer@acme.com ")).toBe(false);
    expect(isHouseTestEmail("chris+foo@gmail.com")).toBe(false);
    expect(isHouseTestEmail(null)).toBe(false);
  });

  it("keeps the proof account out of the test-profile set", () => {
    const brand1 = TEST_ACCOUNTS.find((account) => account.key === "brand1");
    expect(brand1?.email).toBe(PROOF_ACCOUNT_EMAIL);
    expect(brand1?.userId).toBe(PROOF_ACCOUNT_USER_ID);
    expect(isProofAccount(PROOF)).toBe(true);
    expect(isHouseTestEmail(PROOF_ACCOUNT_EMAIL)).toBe(true);
    expect(isTestOrSeedProfile(PROOF)).toBe(false);
    expect(isTestOrSeedProfile(BRAND_TEST)).toBe(true);
    expect(isTestOrSeedProfile(REAL)).toBe(false);
  });

  it("matches the seed name prefix used by the seed-deal tool", () => {
    expect(hasSeedName("[SEED] The Test Feed")).toBe(true);
    expect(hasSeedName("  [SEED] Campaign")).toBe(true);
    expect(hasSeedName("The Test Feed")).toBe(false);
  });
});

describe("stale io_sent", () => {
  it("matches io_sent with no envelope and no IO sent_at", () => {
    expect(
      isStaleIoSent(
        { status: "io_sent", docusign_envelope_id: null },
        [{ sent_at: null }, { sent_at: null }]
      )
    ).toBe(true);
    expect(
      isStaleIoSent({ status: "io_sent", docusign_envelope_id: null }, [])
    ).toBe(true);
  });

  it("does not match when an IO was sent or an envelope exists", () => {
    expect(
      isStaleIoSent(
        { status: "io_sent", docusign_envelope_id: null },
        [{ sent_at: "2026-03-01T00:00:00.000Z" }]
      )
    ).toBe(false);
    expect(
      isStaleIoSent(
        { status: "io_sent", docusign_envelope_id: "env-1" },
        [{ sent_at: null }]
      )
    ).toBe(false);
    expect(
      isStaleIoSent({ status: "planning", docusign_envelope_id: null }, [])
    ).toBe(false);
  });
});

describe("money guards", () => {
  it("treats a Stripe intent, a legacy charge id, charged_at, or a settled status as a charge", () => {
    expect(paymentIsStripeCharge(payment())).toBe(false);
    expect(
      paymentIsStripeCharge(payment({ stripe_payment_intent_id: "pi_123" }))
    ).toBe(true);
    expect(paymentIsStripeCharge(payment({ stripe_payment_id: "ch_123" }))).toBe(
      true
    );
    expect(
      paymentIsStripeCharge(payment({ charged_at: "2026-03-01T00:00:00.000Z" }))
    ).toBe(true);
    expect(paymentIsStripeCharge(payment({ amount_charged_cents: 2500 }))).toBe(
      true
    );
    expect(paymentIsStripeCharge(payment({ status: "succeeded" }))).toBe(true);
    expect(paymentIsStripeCharge(payment({ status: "failed" }))).toBe(false);
  });

  it("blocks sent or paid invoices", () => {
    expect(invoiceBlocksDeletion(invoice())).toBe(false);
    expect(invoiceBlocksDeletion(invoice({ status: "paid" }))).toBe(true);
    expect(invoiceBlocksDeletion(invoice({ status: "sent" }))).toBe(true);
    expect(
      invoiceBlocksDeletion(invoice({ sent_at: "2026-03-01T00:00:00.000Z" }))
    ).toBe(true);
  });
});

describe("planCleanup", () => {
  it("deletes a stale io_sent deal owned by a test profile, with its IO", () => {
    const snapshot = emptySnapshot();
    snapshot.deals.push(deal({ status: "io_sent" }));
    snapshot.insertionOrders.push({
      id: "io-1",
      deal_id: "deal-1",
      sent_at: null,
      status: "draft",
      created_at: "2026-02-02T00:00:00.000Z",
    });

    const plan = planCleanup(snapshot);
    const row = plan.delete.find((item) => item.id === "deal-1");
    expect(row).toMatchObject({
      type: "deal",
      owner: BRAND_TEST.email,
      created_at: "2026-02-01T00:00:00.000Z",
    });
    expect(row?.reasons).toEqual(
      expect.arrayContaining(["stale_io_sent", "test_or_seed_profile"])
    );
    expect(idsOf(plan, "insertion_order")).toEqual(["io-1"]);
    expect(plan.delete.find((item) => item.id === "io-1")?.reasons).toEqual([
      "child_of_cleanup",
    ]);
    expect(plan.excluded).toEqual([]);
  });

  it("holds a stale io_sent deal owned by a non-test profile", () => {
    const snapshot = emptySnapshot();
    snapshot.deals.push(
      deal({ id: "deal-real", brand_id: REAL.id, status: "io_sent" })
    );

    const plan = planCleanup(snapshot);
    expect(plan.delete).toEqual([]);
    expect(plan.excluded).toEqual([
      expect.objectContaining({
        id: "deal-real",
        type: "deal",
        owner: REAL.email,
        matched: ["stale_io_sent"],
        excludedBecause: "non_test_profile",
      }),
    ]);
  });

  it("does not match a real planning deal, and a sent IO is not stale", () => {
    const snapshot = emptySnapshot();
    snapshot.deals.push(deal({ id: "real-planning", brand_id: REAL.id }));
    snapshot.deals.push(
      deal({
        id: "sent-io",
        brand_id: REAL.id,
        status: "io_sent",
        created_at: "2026-02-04T00:00:00.000Z",
      })
    );
    snapshot.insertionOrders.push({
      id: "io-sent",
      deal_id: "sent-io",
      sent_at: "2026-02-05T00:00:00.000Z",
      status: "sent",
      created_at: "2026-02-05T00:00:00.000Z",
    });

    const plan = planCleanup(snapshot);
    expect(plan.delete).toEqual([]);
    expect(plan.excluded).toEqual([]);
  });

  it("deletes a test-profile deal even when the show profile belongs to a real show", () => {
    const snapshot = emptySnapshot();
    snapshot.showProfiles.push({ id: "sp-real", user_id: REAL.id });
    snapshot.deals.push(
      deal({ id: "deal-show", show_profile_id: "sp-real", status: "live" })
    );

    const plan = planCleanup(snapshot);
    expect(idsOf(plan, "deal")).toEqual(["deal-show"]);
    expect(plan.delete[0]?.reasons).toEqual(["test_or_seed_profile"]);
  });

  it("leaves a real brand's deal alone when the show side is a test profile", () => {
    const snapshot = emptySnapshot();
    snapshot.showProfiles.push({ id: "sp-test", user_id: SHOW_TEST.id });
    snapshot.deals.push(
      deal({
        id: "deal-real-show",
        brand_id: REAL.id,
        show_profile_id: "sp-test",
      })
    );

    const plan = planCleanup(snapshot);
    expect(plan.delete).toEqual([]);
    expect(plan.excluded).toEqual([]);
  });

  it("deletes an unsent io_sent deal on the proof account and keeps the proof deal", () => {
    const snapshot = emptySnapshot();
    snapshot.deals.push(
      deal({
        id: PROOF_DEAL_ID,
        brand_id: PROOF.id,
        status: "io_sent",
        created_at: "2026-01-15T00:00:00.000Z",
      }),
      deal({
        id: "stale-proof",
        brand_id: PROOF.id,
        status: "io_sent",
        created_at: "2026-01-16T00:00:00.000Z",
      }),
      deal({
        id: "enveloped-proof",
        brand_id: PROOF.id,
        status: "brand_signed",
        docusign_envelope_id: "env-live",
        show_id: "seed-show",
        created_at: "2026-01-17T00:00:00.000Z",
      })
    );
    snapshot.shows.push({
      id: "seed-show",
      name: "[SEED] Proof Feed",
      slug: "seed-proof",
      data_sources: ["seed"],
      created_at: "2026-01-10T00:00:00.000Z",
    });
    snapshot.insertionOrders.push(
      {
        id: "io-proof",
        deal_id: PROOF_DEAL_ID,
        sent_at: null,
        status: "draft",
        created_at: "2026-01-15T01:00:00.000Z",
      },
      {
        id: "io-stale",
        deal_id: "stale-proof",
        sent_at: null,
        status: "draft",
        created_at: "2026-01-16T01:00:00.000Z",
      }
    );
    snapshot.lineItems.push(
      {
        id: "line-proof",
        io_id: "io-proof",
        created_at: "2026-01-15T02:00:00.000Z",
      },
      {
        id: "line-stale",
        io_id: "io-stale",
        created_at: "2026-01-16T02:00:00.000Z",
      }
    );
    snapshot.payments.push(
      payment({
        id: "pay-proof-charge",
        deal_id: "charged-proof",
        stripe_payment_intent_id: "pi_proof",
      })
    );
    snapshot.deals.push(
      deal({
        id: "charged-proof",
        brand_id: PROOF.id,
        status: "io_sent",
        created_at: "2026-01-18T00:00:00.000Z",
      })
    );

    const plan = planCleanup(snapshot);
    expect(idsOf(plan, "deal")).toEqual(["stale-proof"]);
    expect(idsOf(plan, "insertion_order")).toEqual(["io-stale"]);
    expect(idsOf(plan, "io_line_item")).toEqual(["line-stale"]);
    for (const id of [PROOF_DEAL_ID, "io-proof", "line-proof", "enveloped-proof", "charged-proof"]) {
      expect(plan.delete.map((row) => row.id)).not.toContain(id);
    }
    expect(plan.delete.find((row) => row.id === "stale-proof")?.reasons).toEqual(
      expect.arrayContaining(["stale_io_sent", "proof_account_deal"])
    );
    expect(plan.delete.find((row) => row.id === "stale-proof")?.owner).toBe(
      PROOF_ACCOUNT_EMAIL
    );
    expect(plan.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: PROOF_DEAL_ID,
          excludedBecause: "proof_deal",
          matched: expect.arrayContaining(["stale_io_sent"]),
        }),
        expect.objectContaining({
          id: "enveloped-proof",
          excludedBecause: "docusign_envelope",
        }),
        expect.objectContaining({
          id: "charged-proof",
          excludedBecause: "stripe_charge",
        }),
      ])
    );
  });

  it("deletes a no-envelope proof-account deal when the profile row is missing", () => {
    const snapshot = emptySnapshot();
    snapshot.profiles = snapshot.profiles.filter((row) => row.id !== PROOF.id);
    snapshot.deals.push(
      deal({
        id: "missing-proof",
        brand_id: PROOF_ACCOUNT_USER_ID,
        show_id: "seed-show",
        status: "io_sent",
      })
    );
    snapshot.shows.push({
      id: "seed-show",
      name: "[SEED] Missing profile",
      slug: null,
      data_sources: ["seed"],
      created_at: "2026-01-10T00:00:00.000Z",
    });

    const plan = planCleanup(snapshot);
    expect(idsOf(plan, "deal")).toEqual(["missing-proof"]);
    expect(plan.delete.map((row) => row.id)).not.toContain(PROOF_DEAL_ID);
  });

  it("deletes a deal recorded on deal.seeded when the owner profile is gone", () => {
    const snapshot = emptySnapshot();
    snapshot.deals.push(
      deal({ id: "event-deal", brand_id: "deleted-user", show_id: "plain-show" })
    );
    snapshot.seedEvents.push({
      event_type: "deal.seeded",
      payload: {
        dealId: "event-deal",
        showId: "plain-show",
        campaignId: "camp-1",
        outreachId: "out-1",
      },
    });

    const plan = planCleanup(snapshot);
    expect(plan.delete.find((row) => row.id === "event-deal")?.reasons).toEqual([
      "seeded_deal",
    ]);
  });

  it("deletes a [SEED] campaign and deal owned by a test profile, and holds a [SEED] campaign on a real profile", () => {
    const snapshot = emptySnapshot();
    snapshot.campaigns.push({
      id: "camp-test",
      user_id: BRAND_TEST.id,
      name: "[SEED] Test Campaign",
      brief: { seeded: true },
      created_at: "2026-01-20T00:00:00.000Z",
    });
    snapshot.campaigns.push({
      id: "camp-real",
      user_id: REAL.id,
      name: "[SEED] Should stay",
      brief: { seeded: true },
      created_at: "2026-01-21T00:00:00.000Z",
    });
    snapshot.deals.push(
      deal({ id: "deal-camp", campaign_id: "camp-test", show_id: "show-1" })
    );

    const plan = planCleanup(snapshot);
    expect(idsOf(plan, "campaign")).toEqual(["camp-test"]);
    expect(idsOf(plan, "deal")).toEqual(["deal-camp"]);
    expect(plan.delete.find((row) => row.id === "camp-test")?.reasons).toEqual(
      expect.arrayContaining(["seeded_campaign", "test_or_seed_profile"])
    );
    expect(plan.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "camp-real",
          type: "campaign",
          owner: REAL.email,
          excludedBecause: "non_test_profile",
        }),
      ])
    );
  });

  it("keeps the campaign when one of its deals has a Stripe charge", () => {
    const snapshot = emptySnapshot();
    snapshot.campaigns.push({
      id: "camp-mix",
      user_id: BRAND_TEST.id,
      name: "Test mix",
      brief: {},
      created_at: "2026-01-20T00:00:00.000Z",
    });
    snapshot.deals.push(
      deal({ id: "deal-clean", campaign_id: "camp-mix", created_at: "2026-02-01T00:00:00.000Z" })
    );
    snapshot.deals.push(
      deal({ id: "deal-charged", campaign_id: "camp-mix", created_at: "2026-02-02T00:00:00.000Z" })
    );
    snapshot.payments.push(
      payment({ id: "pay-charged", deal_id: "deal-charged", stripe_payment_intent_id: "pi_live" })
    );

    const plan = planCleanup(snapshot);
    expect(idsOf(plan, "deal")).toEqual(["deal-clean"]);
    expect(idsOf(plan, "campaign")).toEqual([]);
    expect(idsOf(plan, "payment")).toEqual([]);
    expect(plan.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "deal-charged", excludedBecause: "stripe_charge" }),
        expect.objectContaining({ id: "camp-mix", excludedBecause: "retained_deal" }),
      ])
    );
  });

  it("excludes a deal that has a payout even when the transfer id is still null", () => {
    const snapshot = emptySnapshot();
    snapshot.deals.push(deal());
    snapshot.payments.push(payment());
    snapshot.payouts.push({
      id: "po-1",
      payment_id: "pay-1",
      stripe_transfer_id: null,
      transferred_at: null,
      created_at: "2026-02-04T00:00:00.000Z",
    });

    const plan = planCleanup(snapshot);
    expect(plan.delete).toEqual([]);
    expect(plan.excluded[0]).toMatchObject({
      id: "deal-1",
      excludedBecause: "stripe_transfer",
    });
  });

  it("excludes a deal with a paid invoice and deletes a draft invoice with the deal", () => {
    const snapshot = emptySnapshot();
    snapshot.deals.push(deal({ id: "deal-paid" }));
    snapshot.deals.push(
      deal({ id: "deal-draft", created_at: "2026-02-06T00:00:00.000Z" })
    );
    snapshot.insertionOrders.push(
      {
        id: "io-paid",
        deal_id: "deal-paid",
        sent_at: null,
        status: "draft",
        created_at: "2026-02-02T00:00:00.000Z",
      },
      {
        id: "io-draft",
        deal_id: "deal-draft",
        sent_at: null,
        status: "draft",
        created_at: "2026-02-07T00:00:00.000Z",
      }
    );
    snapshot.invoices.push(
      invoice({ id: "inv-paid", io_id: "io-paid", status: "paid" }),
      invoice({ id: "inv-draft", io_id: "io-draft", status: "draft" })
    );

    const plan = planCleanup(snapshot);
    expect(idsOf(plan, "deal")).toEqual(["deal-draft"]);
    expect(idsOf(plan, "invoice")).toEqual(["inv-draft"]);
    expect(plan.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "deal-paid", excludedBecause: "settled_invoice" }),
      ])
    );
  });

  it("includes an orphaned IO and line item, and holds an orphan IO that was charged", () => {
    const snapshot = emptySnapshot();
    snapshot.insertionOrders.push({
      id: "io-orphan",
      deal_id: "missing-deal",
      sent_at: null,
      status: "draft",
      created_at: "2026-03-01T00:00:00.000Z",
    });
    snapshot.lineItems.push({
      id: "line-orphan-io",
      io_id: "io-orphan",
      created_at: "2026-03-02T00:00:00.000Z",
    });
    snapshot.lineItems.push({
      id: "line-no-io",
      io_id: "missing-io",
      created_at: "2026-03-03T00:00:00.000Z",
    });
    snapshot.insertionOrders.push({
      id: "io-charged",
      deal_id: "also-missing",
      sent_at: null,
      status: "draft",
      created_at: "2026-03-04T00:00:00.000Z",
    });
    snapshot.payments.push(
      payment({
        id: "pay-orphan",
        deal_id: null,
        io_line_item_id: null,
        invoice_id: null,
        stripe_payment_intent_id: "pi_orphan",
      })
    );
    snapshot.invoices.push(
      invoice({ id: "inv-charged", io_id: "io-charged", status: "draft" })
    );
    snapshot.payments.push(
      payment({
        id: "pay-on-inv",
        deal_id: null,
        invoice_id: "inv-charged",
        stripe_payment_intent_id: "pi_inv",
      })
    );

    const plan = planCleanup(snapshot);
    expect(plan.delete.find((row) => row.id === "io-orphan")).toMatchObject({
      type: "insertion_order",
      owner: "none",
      reasons: ["orphaned_io"],
    });
    expect(idsOf(plan, "io_line_item")).toEqual(
      expect.arrayContaining(["line-orphan-io", "line-no-io"])
    );
    expect(plan.delete.find((row) => row.id === "line-no-io")?.reasons).toEqual([
      "orphaned_line_item",
    ]);
    expect(idsOf(plan, "insertion_order")).not.toContain("io-charged");
    expect(plan.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "io-charged",
          matched: ["orphaned_io"],
          excludedBecause: "stripe_charge",
        }),
      ])
    );
  });

  it("deletes children before parents and writes one domain event per batch", () => {
    const snapshot = emptySnapshot();
    snapshot.shows.push({
      id: "show-seed",
      name: "[SEED] The Test Feed",
      slug: "seed-feed",
      data_sources: ["seed"],
      created_at: "2026-01-05T00:00:00.000Z",
    });
    snapshot.campaigns.push({
      id: "camp-1",
      user_id: BRAND_TEST.id,
      name: "[SEED] Test Campaign",
      brief: { seeded: true, seed_batch: "2026-01-06" },
      created_at: "2026-01-06T00:00:00.000Z",
    });
    snapshot.brandProfiles.push({ id: "bp-1", user_id: BRAND_TEST.id });
    snapshot.outreaches.push({
      id: "out-1",
      brand_profile_id: "bp-1",
      campaign_id: "camp-1",
      show_id: "show-seed",
      show_name: "[SEED] The Test Feed",
      token: "seed-abc",
      sent_to_email: "chris+show1@taylslate.com",
      created_at: "2026-01-07T00:00:00.000Z",
    });
    snapshot.deals.push(
      deal({
        id: "deal-1",
        campaign_id: "camp-1",
        show_id: "show-seed",
        outreach_id: "out-1",
        brand_profile_id: "bp-1",
      })
    );
    snapshot.insertionOrders.push({
      id: "io-1",
      deal_id: "deal-1",
      sent_at: null,
      status: "draft",
      created_at: "2026-02-02T00:00:00.000Z",
    });
    snapshot.lineItems.push({
      id: "line-1",
      io_id: "io-1",
      created_at: "2026-02-03T00:00:00.000Z",
    });
    snapshot.invoices.push(invoice({ id: "inv-1", io_id: "io-1" }));
    snapshot.invoiceLineItems.push({
      id: "ili-1",
      invoice_id: "inv-1",
      io_line_item_id: "line-1",
      created_at: "2026-02-04T00:00:00.000Z",
    });
    snapshot.payments.push(payment({ id: "pay-1", deal_id: "deal-1", io_line_item_id: "line-1" }));
    snapshot.airchecks.push({
      id: "air-1",
      io_line_item_id: "line-1",
      created_at: "2026-02-05T00:00:00.000Z",
    });

    const plan = planCleanup(snapshot);
    const types = plan.delete.map((row) => row.type);
    const indexes = types.map((type) => DELETION_ORDER.indexOf(type));
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    expect(plan.delete.map((row) => `${row.type}:${row.id}`)).toEqual([
      "invoice_line_item:ili-1",
      "payment:pay-1",
      "invoice:inv-1",
      "aircheck:air-1",
      "io_line_item:line-1",
      "insertion_order:io-1",
      "deal:deal-1",
      "outreach:out-1",
      "campaign:camp-1",
      "show:show-seed",
    ]);

    const events = domainEventsForBatches(plan.batches);
    expect(events.map((event) => event.entityType)).toEqual(types);
    expect(events).toHaveLength(10);
    expect(events[0]).toMatchObject({
      eventType: "admin.test_data_cleanup",
      entityId: "ili-1",
      payload: { batch: "invoice_line_item", count: 1, dry_run: false },
    });
    expect(plan.delete.some((row) => row.ownerProfileId === PROOF.id)).toBe(false);

    const report = formatCleanupReport(plan);
    expect(report).toContain("delete_count: 10");
    expect(report).toContain(
      `deal-1\tdeal\t${BRAND_TEST.email}\t2026-02-01T00:00:00.000Z\t`
    );
    expect(report).toContain("seeded_deal");
    expect(report).toContain(PROOF_DEAL_ID);
  });

  it("does not delete a seed show that a kept deal still references", () => {
    const snapshot = emptySnapshot();
    snapshot.shows.push({
      id: "show-seed",
      name: "[SEED] Shared",
      slug: "shared",
      data_sources: ["seed"],
      created_at: "2026-01-05T00:00:00.000Z",
    });
    snapshot.deals.push(deal({ id: "deal-test", show_id: "show-seed" }));
    snapshot.deals.push(
      deal({
        id: "deal-real",
        brand_id: REAL.id,
        show_id: "show-seed",
        created_at: "2026-02-08T00:00:00.000Z",
      })
    );

    const plan = planCleanup(snapshot);
    expect(idsOf(plan, "deal")).toEqual(["deal-test"]);
    expect(idsOf(plan, "show")).toEqual([]);
    expect(plan.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "show-seed", excludedBecause: "retained_deal" }),
      ])
    );
  });

  it("does not treat a Podscan catalog show tagged data_sources seed as test data", () => {
    const snapshot = emptySnapshot();
    snapshot.shows.push({
      id: "catalog-show",
      name: "How I Built This",
      slug: "how-i-built-this",
      data_sources: ["seed", "podscan"],
      created_at: "2025-06-01T00:00:00.000Z",
    });
    snapshot.deals.push(
      deal({
        id: "deal-on-catalog",
        brand_id: REAL.id,
        show_id: "catalog-show",
        status: "io_sent",
      })
    );

    const plan = planCleanup(snapshot);
    expect(idsOf(plan, "show")).toEqual([]);
    expect(idsOf(plan, "deal")).toEqual([]);
    expect(plan.excluded.find((row) => row.id === "catalog-show")).toBeUndefined();
    expect(plan.excluded.find((row) => row.id === "deal-on-catalog")).toMatchObject({
      matched: ["stale_io_sent"],
      excludedBecause: "non_test_profile",
    });
  });

  it("deletes a materialized otr- show only with the seeded outreach", () => {
    const snapshot = emptySnapshot();
    snapshot.brandProfiles.push({ id: "bp-1", user_id: BRAND_TEST.id });
    snapshot.campaigns.push({
      id: "camp-1",
      user_id: BRAND_TEST.id,
      name: "[SEED] Non catalog",
      brief: { seeded: true },
      created_at: "2026-01-06T00:00:00.000Z",
    });
    snapshot.outreaches.push({
      id: "abcdef12-0000-4000-8000-000000000001",
      brand_profile_id: "bp-1",
      campaign_id: "camp-1",
      show_id: null,
      show_name: "[SEED] Materialized",
      token: "pending_seed_abc",
      sent_to_email: "chris+seedotr-abc@taylslate.com",
      created_at: "2026-01-07T00:00:00.000Z",
    });
    snapshot.shows.push({
      id: "show-otr",
      name: "Materialized feed",
      slug: "otr-abcdef12-materialized-feed",
      data_sources: [],
      created_at: "2026-01-08T00:00:00.000Z",
    });

    const plan = planCleanup(snapshot);
    expect(idsOf(plan, "show")).toEqual(["show-otr"]);
    expect(idsOf(plan, "outreach")).toEqual([
      "abcdef12-0000-4000-8000-000000000001",
    ]);
  });
});

describe("confirm gate", () => {
  it("stays a dry run unless --execute and --confirm match the delete count", () => {
    expect(parseCleanupArgs([])).toEqual({ execute: false, confirm: null });
    expect(parseCleanupArgs(["--dry-run"])).toEqual({ execute: false, confirm: null });
    expect(parseCleanupArgs(["--execute", "--confirm=4"])).toEqual({
      execute: true,
      confirm: 4,
    });
    expect(() => parseCleanupArgs(["--confirm=nope"])).toThrow(/unknown argument/);
    expect(() => parseCleanupArgs(["--execute", "--execute"])).toThrow(/duplicate/);

    expect(confirmGate({ execute: false, confirm: null }, 4).proceed).toBe(false);
    expect(confirmGate({ execute: false, confirm: null }, 4).message).toContain(
      "--confirm=4"
    );
    expect(confirmGate({ execute: true, confirm: null }, 4).proceed).toBe(false);
    expect(confirmGate({ execute: true, confirm: 3 }, 4).proceed).toBe(false);
    expect(confirmGate({ execute: true, confirm: 3 }, 4).message).toContain(
      "Nothing was written"
    );
    expect(confirmGate({ execute: true, confirm: 4 }, 4)).toMatchObject({
      proceed: true,
    });
  });
});

describe("migration 043", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/043_cleanup_test_data.sql"),
    "utf8"
  );

  it("deletes children before parents, logs one event per batch, and does not delete profiles, payouts, or auth users", () => {
    const calls = [
      "cleanup_test_data_delete_batch('invoice_line_items'",
      "cleanup_test_data_log_batch('invoice_line_item'",
      "cleanup_test_data_delete_batch('payments'",
      "cleanup_test_data_log_batch('payment'",
      "cleanup_test_data_delete_batch('invoices'",
      "cleanup_test_data_log_batch('invoice'",
      "cleanup_test_data_delete_batch('airchecks'",
      "cleanup_test_data_log_batch('aircheck'",
      "cleanup_test_data_delete_batch('io_line_items'",
      "cleanup_test_data_log_batch('io_line_item'",
      "cleanup_test_data_delete_batch('insertion_orders'",
      "cleanup_test_data_log_batch('insertion_order'",
      "cleanup_test_data_delete_batch('deals'",
      "cleanup_test_data_log_batch('deal'",
      "cleanup_test_data_delete_batch('outreaches'",
      "cleanup_test_data_log_batch('outreach'",
      "cleanup_test_data_delete_batch('campaigns'",
      "cleanup_test_data_log_batch('campaign'",
      "cleanup_test_data_delete_batch('shows'",
      "cleanup_test_data_log_batch('show'",
    ];
    let last = -1;
    for (const call of calls) {
      const at = sql.indexOf(call);
      expect(at, call).toBeGreaterThan(last);
      last = at;
    }
    expect(sql).toContain("admin.test_data_cleanup");
    expect(sql).toContain(PROOF_DEAL_ID);
    expect(sql).toContain(PROOF_ACCOUNT_EMAIL);
    expect(sql).toContain(PROOF_ACCOUNT_USER_ID);
    expect(sql).toContain("refusing a child of the proof deal");
    expect(sql).toContain("refusing proof-account deal with a docusign envelope");
    expect(sql).toContain("security invoker");
    expect(sql).not.toMatch(/delete from public\.profiles/i);
    expect(sql).not.toMatch(/delete from public\.payouts/i);
    expect(sql).not.toMatch(/delete from auth\.users/i);
    expect(sql).not.toContain("'profiles'");
    expect(sql).not.toContain("'payouts'");
    expect(sql).toContain("grant execute on function public.cleanup_test_data");
    expect(sql).toContain("from anon");
    expect(sql).toContain("from authenticated");
  });
});
