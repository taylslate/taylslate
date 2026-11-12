import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SECRET_DB } from "@/lib/mcp-oauth/test-store";

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: () => {
      throw new Error(SECRET_DB);
    },
  },
}));

import { protectedResourceMetadata } from "@/lib/mcp-oauth/config";
import { GET, OPTIONS } from "./route";

const SAVED_SITE = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.taylslate.com";
});

afterEach(() => {
  if (SAVED_SITE === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = SAVED_SITE;
});

function get(path: string[]): Promise<Response> {
  return GET(new Request("https://www.taylslate.com/.well-known/oauth-protected-resource"), {
    params: Promise.resolve({ path }),
  });
}

describe("GET /.well-known/oauth-protected-resource/[...path]", () => {
  it("serves only the mcp suffix", async () => {
    const ok = await get(["api", "v1", "mcp"]);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(protectedResourceMetadata());
    expect(ok.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(ok.headers.get("access-control-allow-origin")).toBe("*");
    const missing = await get(["other"]);
    expect(missing.status).toBe(404);
    expect(OPTIONS().status).toBe(204);
  });

  it("answers 503 for the mcp suffix when the origin is unset", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const response = await get(["api", "v1", "mcp"]);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("temporarily_unavailable");
    expect(JSON.stringify(body)).not.toContain(SECRET_DB);
  });
});
