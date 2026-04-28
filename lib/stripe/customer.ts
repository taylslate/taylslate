// Helper for materialising the Stripe Customer that backs a Taylslate
// profile. Idempotent — if `profile.stripe_customer_id` already points at
// a Stripe customer we return it untouched. Otherwise we create one and
// persist the id back onto the profile via the service-role admin client.
//
// Wave 13 callers (subscription billing, payment intents, payouts) all
// rely on this helper rather than calling `stripe.customers.create`
// directly, so the "one Stripe customer per profile" invariant has a
// single owner.

import { stripe } from "./server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Minimal shape this helper needs off a profile row. Defined locally so
 * we don't drag in the trimmed `Profile` TS type (which doesn't carry
 * `stripe_customer_id`). `id` and `email` are the only required fields.
 */
export interface StripeCustomerProfileInput {
  id: string;
  email: string;
  full_name?: string | null;
  company_name?: string | null;
  stripe_customer_id?: string | null;
}

/**
 * Returns the Stripe customer id for a profile, creating one on demand.
 *
 * - If `profile.stripe_customer_id` is set, returns it without touching Stripe.
 * - Otherwise creates a new Stripe customer with the profile's email/name and
 *   `metadata.profile_id`, writes the id back to `profiles.stripe_customer_id`
 *   via the service-role admin client, and returns the new id.
 *
 * Throws on Stripe error or persistence error — callers handle.
 */
export async function getOrCreateStripeCustomer(
  profile: StripeCustomerProfileInput
): Promise<string> {
  if (profile.stripe_customer_id) {
    return profile.stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email: profile.email,
    name: profile.full_name ?? undefined,
    metadata: {
      profile_id: profile.id,
      ...(profile.company_name ? { company_name: profile.company_name } : {}),
    },
  });

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("id", profile.id);

  if (error) {
    // Don't try to roll back the Stripe-side create — the customer is
    // safe to reuse on a retry once the persistence issue is resolved.
    throw new Error(
      `Failed to persist stripe_customer_id for profile ${profile.id}: ${error.message}`
    );
  }

  return customer.id;
}
