// Service-role Supabase client. Built on first property access, not at import.
//
// Next collects page data by importing route modules. /api/auth/magic (and
// every other importer of this module) used to call createClient() while the
// module was still loading. With SUPABASE_SERVICE_ROLE_KEY unset that throws
// "supabaseKey is required" and fails the build. Callers still use
// `supabaseAdmin.from(...)`. The client stays a process-wide singleton, and
// createClient receives the same two env vars — there is no fallback key.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

function getSupabaseAdmin(): SupabaseClient {
  if (cachedClient) return cachedClient;
  cachedClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  return cachedClient;
}

// Receiver is the real client so getters (for example `functions`) see the
// instance that owns the URLs and headers. Methods are bound so a call through
// the proxy uses that same instance.
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseAdmin();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
