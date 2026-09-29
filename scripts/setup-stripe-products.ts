// One-off script to create the Stripe Products + Prices that back the
// subscription tiers. Idempotent: re-running on a Stripe environment
// that already has the products is a no-op (looks up by Product name and
// reuses the existing recurring monthly Price if one matches the amount).
//
// Run against sandbox first (STRIPE_ENV=sandbox), copy the printed Price IDs
// into lib/billing/constants.ts under SANDBOX, then repeat against production
// when the customer-facing launch happens.
//
// Usage:
//   STRIPE_ENV=sandbox STRIPE_SECRET_KEY=sk_test_... \
//     npx tsx scripts/setup-stripe-products.ts
//
// Pricing source of truth: PRICING_DECISIONS.md (Locked 2026-09-28)
//   Starter base:    $79/mo
//   Operator base:  $299/mo
// Seat and Agency products below are legacy catalogue rows. Seats are not
// sold (additionalSeatCents is 0). Do not run this script as part of a
// copy update.

import { stripe } from "@/lib/stripe/server";

interface ProductSpec {
  key: string;
  name: string;
  description: string;
  unitAmountCents: number;
  metadata: Record<string, string>;
}

const SPECS: ProductSpec[] = [
  {
    key: "starter_base",
    name: "Taylslate Starter",
    description: "Starter subscription — $79/mo + 8% card fee.",
    unitAmountCents: 7900,
    metadata: { taylslate_plan: "starter", taylslate_role: "base" },
  },
  {
    key: "operator_base",
    name: "Taylslate Operator",
    description: "Operator subscription — $299/mo + 6% card fee.",
    unitAmountCents: 29900,
    metadata: { taylslate_plan: "operator", taylslate_role: "base" },
  },
  {
    key: "operator_seat",
    name: "Taylslate Operator — Additional Seat",
    description: "Additional seat on the Operator plan.",
    unitAmountCents: 29900,
    metadata: { taylslate_plan: "operator", taylslate_role: "seat" },
  },
  {
    key: "agency_base",
    name: "Taylslate Agency",
    description: "Agency subscription — $5,000/mo + 4% transaction fee.",
    unitAmountCents: 500000,
    metadata: { taylslate_plan: "agency", taylslate_role: "base" },
  },
  {
    key: "agency_seat",
    name: "Taylslate Agency — Additional Seat",
    description: "Additional seat on the Agency plan.",
    unitAmountCents: 50000,
    metadata: { taylslate_plan: "agency", taylslate_role: "seat" },
  },
];

async function findProductByName(name: string) {
  // The Stripe SDK's `products.list` is paginated; auto-pagination iterates
  // every page transparently.
  for await (const product of stripe.products.list({ active: true, limit: 100 })) {
    if (product.name === name) return product;
  }
  return null;
}

async function findRecurringPrice(productId: string, unitAmountCents: number) {
  for await (const price of stripe.prices.list({
    product: productId,
    active: true,
    limit: 100,
  })) {
    if (
      price.recurring?.interval === "month" &&
      price.unit_amount === unitAmountCents &&
      price.currency === "usd"
    ) {
      return price;
    }
  }
  return null;
}

async function ensureProductAndPrice(spec: ProductSpec) {
  let product = await findProductByName(spec.name);

  if (product) {
    console.log(`[skip] product exists: ${spec.name} (${product.id})`);
  } else {
    product = await stripe.products.create({
      name: spec.name,
      description: spec.description,
      metadata: spec.metadata,
    });
    console.log(`[create] product: ${spec.name} (${product.id})`);
  }

  let price = await findRecurringPrice(product.id, spec.unitAmountCents);

  if (price) {
    console.log(
      `[skip]   price exists: ${(spec.unitAmountCents / 100).toFixed(2)}/mo (${price.id})`
    );
  } else {
    price = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: spec.unitAmountCents,
      recurring: { interval: "month" },
      metadata: spec.metadata,
    });
    console.log(
      `[create] price: ${(spec.unitAmountCents / 100).toFixed(2)}/mo (${price.id})`
    );
  }

  return { spec, productId: product.id, priceId: price.id };
}

async function main() {
  const env = process.env.STRIPE_ENV ?? "sandbox";
  console.log(`Setting up Stripe products in env=${env}\n`);

  const results: Array<{
    spec: ProductSpec;
    productId: string;
    priceId: string;
  }> = [];

  for (const spec of SPECS) {
    const result = await ensureProductAndPrice(spec);
    results.push(result);
  }

  console.log(
    `\nPaste these Price IDs into lib/billing/constants.ts under ${env.toUpperCase()}:`
  );
  console.log(
    "------------------------------------------------------------"
  );
  for (const r of results) {
    console.log(`  ${r.spec.key.padEnd(16)} = "${r.priceId}"`);
  }
  console.log(
    "------------------------------------------------------------\n"
  );
  console.log("Verify in the Stripe dashboard before committing.");
}

main().catch((err) => {
  console.error("setup-stripe-products failed:", err);
  process.exit(1);
});
