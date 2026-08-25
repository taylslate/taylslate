// Stripe server-side client. Lazy-loaded via runtime require so Turbopack
// keeps the SDK out of the bundle graph (same pattern used by docusign-esign
// in lib/docusign/client.ts:27-35).
//
// Public surface preserved: callers continue to `import { stripe } from
// "@/lib/stripe/server"` and use `stripe.customers.create(...)` etc. The
// difference is that the SDK module is resolved on first property access,
// not at import time.
//
// IMPORTANT: do not switch to `import Stripe from "stripe"` — that crashes
// the Next.js build under Turbopack (UMD-style internals the bundler can't
// statically analyse). Also ensure `"stripe"` is listed in
// next.config.ts → serverExternalPackages.

import type Stripe from "stripe";
import { createRequire } from "node:module";

const STRIPE_API_VERSION = "2026-03-25.dahlia" as const;

let cachedClient: Stripe | null = null;

// Node's own CommonJS require, bound to this module's URL. Independent of any
// global `require` — the previous (0, eval)("require") threw "require is not
// defined" in Turbopack's ESM server bundle, where no global require exists.
const nodeRequire = createRequire(import.meta.url);

function loadStripeCtor(): new (key: string, opts: Stripe.StripeConfig) => Stripe {
  // Load through a Function whose body Turbopack cannot statically analyze, so it
  // never traces stripe's UMD internals (which the bundler can't handle). We
  // inject `nodeRequire` (a real createRequire-based require) as the parameter,
  // so the load does NOT depend on a global `require`, which the ESM server
  // bundle lacks. serverExternalPackages still guarantees the package ships in
  // node_modules for createRequire to resolve.
  const load = new Function("require", "return require('stripe')") as (
    r: (id: string) => unknown
  ) => { default?: unknown };
  const mod = load(nodeRequire);
  // The CJS build exports a constructor as the default export.
  return (mod.default ?? mod) as new (
    key: string,
    opts: Stripe.StripeConfig
  ) => Stripe;
}

function getClient(): Stripe {
  if (cachedClient) return cachedClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  const Ctor = loadStripeCtor();
  cachedClient = new Ctor(key, { apiVersion: STRIPE_API_VERSION });
  return cachedClient;
}

// Proxy keeps the `stripe.customers.create(...)` ergonomics every existing
// caller relies on, while deferring SDK resolution until first use. We type
// it as `Stripe` so TypeScript hands callers the full SDK surface.
export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/** Test helper — clears the cached Stripe client so a fresh env can be picked up. */
export function _resetStripeClientCache(): void {
  cachedClient = null;
}
