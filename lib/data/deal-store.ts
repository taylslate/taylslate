// In-memory deal store. Initialized from seed data, supports runtime additions.
// Uses globalThis to survive Next.js HMR without duplicating or losing state.
// Replace with Supabase queries when connected.

import type { Deal } from "./types";
import { deals as seedDeals } from "./seed";

const globalForDeals = globalThis as unknown as { __taylslateDeals?: Deal[] };

// In dev, reset to seed data on every module re-evaluation (HMR).
// In prod, initialize once.
if (process.env.NODE_ENV === "development" || !globalForDeals.__taylslateDeals) {
  globalForDeals.__taylslateDeals = [...seedDeals];
}

function getStore(): Deal[] {
  return globalForDeals.__taylslateDeals!;
}

export function getAllDeals(): Deal[] {
  return getStore();
}

export function getDealById(id: string): Deal | undefined {
  return getStore().find((d) => d.id === id);
}

export function addDeals(newDeals: Deal[]): void {
  const store = getStore();
  for (const deal of newDeals) {
    if (!store.some((d) => d.id === deal.id)) {
      store.push(deal);
    }
  }
}
