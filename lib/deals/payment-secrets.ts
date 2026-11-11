// Service-role store for a deal's Stripe SetupIntent client secret.
//
// The secret is a confirmable credential. It does not live on deals.
// Migration 086 creates deal_payment_secrets (service_role only).
// Before that file is applied the table is missing: both helpers
// fail soft and never throw. Nothing here is logged except a fixed
// outcome line. The secret and the driver error are not logged.

import { supabaseAdmin } from "@/lib/supabase/admin";

export async function getDealSetupSecret(dealId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("deal_payment_secrets")
      .select("setup_intent_client_secret")
      .eq("deal_id", dealId)
      .maybeSingle<{ setup_intent_client_secret: string }>();
    if (error || !data?.setup_intent_client_secret) {
      if (error) console.warn("[deal-payment-secrets] outcome=read_failed");
      return null;
    }
    return data.setup_intent_client_secret;
  } catch {
    console.warn("[deal-payment-secrets] outcome=read_failed");
    return null;
  }
}

export async function saveDealSetupSecret(
  dealId: string,
  secret: string
): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from("deal_payment_secrets").upsert(
      {
        deal_id: dealId,
        setup_intent_client_secret: secret,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "deal_id" }
    );
    if (error) {
      console.warn("[deal-payment-secrets] outcome=write_failed");
      return false;
    }
    return true;
  } catch {
    console.warn("[deal-payment-secrets] outcome=write_failed");
    return false;
  }
}
