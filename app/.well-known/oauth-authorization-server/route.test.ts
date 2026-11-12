import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SECRET_DB } from "@/lib/mcp-oauth/test-store";

const queries: string[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      queries.push(table);
      throw new Error(SECRET_DB);
    },
  },
}));

import { authorizationServerMetadata } from "@/lib/mcp-oauth/config";
import { GET, OPTIONS } from "./route";

const SAVED_SITE = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  queries.length = 0;
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.taylslate.com";
});

afterEach(() => {
  if (SAVED_SITE === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = SAVED_SITE;
});

describe("GET /.well-known/oauth-authorization-server", () => {
  it("returns the authorization server document without a database call", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(authorizationServerMetadata());
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(queries).toEqual([]);
    expect(OPTIONS().status).toBe(204);
    expect(OPTIONS().headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("answers 503 when the origin is unset", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const response = GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("temporarily_unavailable");
    expect(JSON.stringify(body)).not.toContain(SECRET_DB);
  });
});
