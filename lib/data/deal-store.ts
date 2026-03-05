// In-memory deal store. Initialized from seed data, supports runtime additions.
// Replace with Supabase queries when connected.

import type { Deal } from "./types";
import { deals as seedDeals } from "./seed";

const dealStore: Deal[] = [...seedDeals];

export function getAllDeals(): Deal[] {
  return dealStore;
}

export function getDealById(id: string): Deal | undefined {
  return dealStore.find((d) => d.id === id);
}

export function addDeals(newDeals: Deal[]): void {
  for (const deal of newDeals) {
    // Avoid duplicates by id
    if (!dealStore.some((d) => d.id === deal.id)) {
      dealStore.push(deal);
    }
  }
}
