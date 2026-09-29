// Stripe Price IDs per environment.
//
// Populated by running `scripts/setup-stripe-products.ts` against each
// Stripe environment (sandbox first, then production at launch). Keep the
// blocks in sync whenever a public base price is added.
//
// Resolution: we read STRIPE_ENV ("sandbox" | "production") at runtime and
// pick the matching block. Unknown values fall back to sandbox so a
// missing-env-var deployment doesn't accidentally bill against production.
//
// Placeholders stay "_unset" until that script is run on purpose. Starter
// base is $79/mo. Operator base is $299/mo. Seat prices remain in the map
// for the old subscription item shape; additionalSeatCents is 0, so the
// subscription helpers do not attach them.

export type StripeEnv = "sandbox" | "production";

export interface PriceMap {
  starterBase: string;
  operatorBase: string;
  operatorSeat: string;
  agencyBase: string;
  agencySeat: string;
}

const SANDBOX: PriceMap = {
  starterBase: "price_sandbox_starter_base_unset",
  operatorBase: "price_sandbox_operator_base_unset",
  operatorSeat: "price_sandbox_operator_seat_unset",
  agencyBase: "price_sandbox_agency_base_unset",
  agencySeat: "price_sandbox_agency_seat_unset",
};

const PRODUCTION: PriceMap = {
  starterBase: "price_production_starter_base_unset",
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
