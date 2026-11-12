import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SECRET_DB } from "@/lib/mcp-oauth/test-store";

const queries: string[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      queries.push(table);
      throw new Error(SECRET_DB);
    },
    rpc: () => {
      throw new Error(SECRET_DB);
    },
  },
}));

import { protectedResourceMetadata } from "@/lib/mcp-oauth/config";
import { OPTIONS, GET } from "./route";

const SAVED_SITE = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  queries.length = 0;
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.taylslate.com/";
});

afterEach(() => {
  if (SAVED_SITE === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = SAVED_SITE;
});

describe("GET /.well-known/oauth-protected-resource", () => {
  it("returns the metadata document, cache, and CORS without a database call", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual(protectedResourceMetadata());
    expect(queries).toEqual([]);
    const preflight = OPTIONS();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("answers 503 when the origin is unset", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const response = GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("temporarily_unavailable");
    expect(JSON.stringify(body)).not.toContain(SECRET_DB);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});
