// Deal-derived IO number for the DocuSign signing flow.
//
// Deterministic (same deal → same number) so it doubles as the idempotency
// sentinel in persist-io: insertion_orders.io_number is globally UNIQUE, and a
// concurrent duplicate send collapses into a 23505 instead of a second row.
//
// SINGLE SOURCE OF TRUTH — the PDF generator stamps this on the document, the
// DocuSign webhook matches the insertion_orders row by it, and the backfill
// script validates event payloads against it. A drifted copy in any of those
// would make the webhook UPDATE match zero rows with error=null: signed deals
// silently never marked signed. Never inline this derivation.
//
// (Zero imports on purpose: io-generator imports this, and persist-io's
// module scope initializes the Supabase admin client — a dependency here
// would drag env requirements into pure PDF rendering and tests.)
export function dealIoNumber(dealId: string): string {
  return `IO-${dealId.slice(0, 8).toUpperCase()}`;
}
