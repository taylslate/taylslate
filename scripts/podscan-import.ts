// Local one-time Podscan catalog import. Dry run is the default.
// --commit writes only after migration 093 is applied.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PodscanClient } from "../lib/podscan/client";
import { parseArgs, runImport, type Db, type ShowLink } from "../lib/podscan-import/run";

function loadEnv(): void {
  let envContent = "";
  try {
    envContent = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8");
  } catch {
    return;
  }
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function codeOf(error: { code?: string } | null): { code?: string } | null {
  return error ? { code: error.code } : null;
}

function adapt(client: SupabaseClient): Db {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          return {
            async limit(n: number) {
              const { data, error } = await client.from(table).select(columns).limit(n);
              return { data, error: codeOf(error) };
            },
            async in(column: string, values: string[]) {
              const { data, error } = await client.from(table).select(columns).in(column, values);
              return { data: (data ?? null) as ShowLink[] | null, error: codeOf(error) };
            },
          };
        },
        async upsert(rows: Record<string, unknown>[], options: { onConflict: string }) {
          const { data, error } = await client.from(table).upsert(rows, options);
          return { data, error: codeOf(error) };
        },
      };
    },
  };
}

function isDirect(): boolean {
  const entry = process.argv[1] ?? "";
  return entry.endsWith("podscan-import.ts") || entry.endsWith("podscan-import.js");
}

async function main(): Promise<void> {
  loadEnv();
  let code = 1;
  try {
    const args = parseArgs(process.argv.slice(2));
    const podscan = new PodscanClient(process.env.PODSCAN_API_KEY);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const db = url && serviceKey ? adapt(createClient(url, serviceKey, { auth: { persistSession: false } })) : null;
    const result = await runImport(args, {
      caller: {
        get: (path, params) => podscan.get(path, params, { retries: 0 }),
        post: (path, body) => podscan.post(path, body, { retries: 0 }),
        rateLimit: () => ({
          limit: podscan.getRateLimitLimit(),
          remaining: podscan.getRateLimitRemaining(),
        }),
      },
      db,
      checkpointDir: resolve(process.cwd(), ".podscan-import"),
    });
    code = result.exitCode;
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "PODSCAN_API_KEY is not set" || message === "Missing a flag value." || message === "Unknown flag." || message === "Bad number.") {
      console.error(message);
    } else {
      console.error("podscan-import failed");
    }
    code = 1;
  }
  process.exit(code);
}

if (isDirect()) {
  void main();
}
