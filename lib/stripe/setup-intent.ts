// SetupIntent helper for the pay-as-delivers flow.
//
// Wave 13 fires this when a deal transitions to `brand_signed` (DocuSign
// webhook). The brand has just countersigned the IO and now needs to put
// a card on file — we don't charge it; we just save the payment method
// against the brand's Stripe Customer for later episode-by-episode
// PaymentIntents.
//
// Two callers:
//   1. Teammate 3's `app/api/deals/[id]/setup-intent` route — invoked by
//      the brand UI immediately after DocuSign signing completes.
//   2. The DocuSign webhook handler in lib/docusign/webhook.ts — fires a
//      pre-authorised SetupIntent so the brand UI can confirm without
//      another round-trip.
//
// Both routes funnel through this helper so the SetupIntent attachment
// invariant ("one Stripe Customer per profile, one SetupIntent per deal
// signing event") is enforced in one place.

import type Stripe from "stripe";
import { stripe } from "./server";
import { getOrCreateStripeCustomer, type StripeCustomerProfileInput } from "./customer";

export interface CreateSetupIntentForBrandInput {
  /** Profile row for the brand. Must include id + email; stripe_customer_id is reused if present. */
  profile: StripeCustomerProfileInput;
  /** Deal id is stamped into the SetupIntent metadata so the webhook can wire it back to a deal record. */
  dealId: string;
  /** Optional — payment method types to allow. Defaults to card. */
  paymentMethodTypes?: string[];
}

export interface CreateSetupIntentResult {
  setupIntentId: string;
  clientSecret: string;
  stripeCustomerId: string;
}

/**
 * Creates a SetupIntent against the brand's Stripe Customer (creating
 * the Customer first if needed) and returns the client secret for the
 * brand UI to confirm. Does NOT save anything to Supabase — Teammate 3
 * persists the resulting `payment_method_id` on the deal record from the
 * webhook handler.
 */
export async function createSetupIntentForBrand(
  input: CreateSetupIntentForBrandInput
): Promise<CreateSetupIntentResult> {
  const customerId = await getOrCreateStripeCustomer(input.profile);

  const setupIntent: Stripe.SetupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: input.paymentMethodTypes ?? ["card"],
    usage: "off_session",
    metadata: {
      profile_id: input.profile.id,
      deal_id: input.dealId,
    },
  });

  if (!setupIntent.client_secret) {
    throw new Error(
      `Stripe returned a SetupIntent without a client_secret (id=${setupIntent.id})`
    );
  }

  return {
    setupIntentId: setupIntent.id,
    clientSecret: setupIntent.client_secret,
    stripeCustomerId: customerId,
  };
}
