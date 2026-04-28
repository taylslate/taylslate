// Wave 13 — Stripe Price IDs per environment.
//
// Populated by running `scripts/setup-stripe-products.ts` against each
// Stripe environment (sandbox first, then production at launch). Keep the
// blocks in sync whenever new tiers or seat add-ons are added.
//
// Resolution: we read STRIPE_ENV ("sandbox" | "production") at runtime and
// pick the matching block. Unknown values fall back to sandbox so a
// missing-env-var deployment doesn't accidentally bill against production.

export type StripeEnv = "sandbox" | "production";

export interface PriceMap {
  operatorBase: string;
  operatorSeat: string;
  agencyBase: string;
  agencySeat: string;
}

const SANDBOX: PriceMap = {
  // Populated after running `npx tsx scripts/setup-stripe-products.ts` in
  // sandbox. Until then these placeholders make the unset state obvious if
  // any code path tries to use them at runtime.
  operatorBase: "price_sandbox_operator_base_unset",
  operatorSeat: "price_sandbox_operator_seat_unset",
  agencyBase: "price_sandbox_agency_base_unset",
  agencySeat: "price_sandbox_agency_seat_unset",
};

const PRODUCTION: PriceMap = {
  operatorBase: "price_production_operator_base_unset",
  operatorSeat: "price_production_operator_seat_unset",
  agencyBase: "price_production_agency_base_unset",
  agencySeat: "price_production_agency_seat_unset",
};

export function getStripeEnv(): StripeEnv {
  return process.env.STRIPE_ENV === "production" ? "production" : "sandbox";
}

export function getPriceMap(env: StripeEnv = getStripeEnv()): PriceMap {
  return env === "production" ? PRODUCTION : SANDBOX;
}
