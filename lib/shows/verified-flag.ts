// One rule for "this show is verified."
//
// True only when shows.ownership_status is verified and a
// show_ownership_proofs row for that show has status verified.
// A deal, a show profile, a contact email, shows.is_claimed, and
// shows.is_verified are not read. Any read error returns an empty set.

import { supabaseAdmin } from "@/lib/supabase/admin";

const CHUNK = 80;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StatusRow {
  id?: unknown;
  ownership_status?: unknown;
}

interface ProofRow {
  show_id?: unknown;
  status?: unknown;
}

interface ReadError {
  code?: string;
}

export async function verifiedShowIds(showIds: readonly string[]): Promise<Set<string>> {
  const ids = uniqueIds(showIds);
  if (ids.length === 0) return new Set();
  try {
    const statusOk = new Set<string>();
    for (const chunk of chunks(ids)) {
      const { data, error } = await supabaseAdmin
        .from("shows")
        .select("id, ownership_status")
        .in("id", chunk);
      if (error) {
        warn(error);
        return new Set();
      }
      for (const row of (data ?? []) as StatusRow[]) {
        const id = typeof row.id === "string" ? row.id : "";
        if (id && row.ownership_status === "verified") statusOk.add(id);
      }
    }
    if (statusOk.size === 0) return new Set();

    const proved = new Set<string>();
    for (const chunk of chunks([...statusOk])) {
      const { data, error } = await supabaseAdmin
        .from("show_ownership_proofs")
        .select("show_id, status")
        .in("show_id", chunk)
        .eq("status", "verified");
      if (error) {
        warn(error);
        return new Set();
      }
      for (const row of (data ?? []) as ProofRow[]) {
        const showId = typeof row.show_id === "string" ? row.show_id : "";
        if (showId && row.status === "verified") proved.add(showId);
      }
    }

    const out = new Set<string>();
    for (const id of statusOk) {
      if (proved.has(id)) out.add(id);
    }
    return out;
  } catch {
    console.warn("[shows] verified read", "unknown");
    return new Set();
  }
}

function uniqueIds(showIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of showIds) {
    if (typeof id !== "string" || !UUID.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function chunks(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let index = 0; index < ids.length; index += CHUNK) {
    out.push(ids.slice(index, index + CHUNK));
  }
  return out;
}

function warn(error: ReadError): void {
  console.warn("[shows] verified read", error.code ?? "unknown");
}
