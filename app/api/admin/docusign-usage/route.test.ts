import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedUser, supabaseAdmin, setResult } = vi.hoisted(() => {
  let result: { count: number | null; error: { message: string } | null } = {
    count: 0,
    error: null,
  };
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    then(
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return {
    getAuthenticatedUser: vi.fn(),
    supabaseAdmin: { from: vi.fn(() => builder) },
    setResult(next: typeof result) {
      result = next;
    },
  };
});

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));

import { dynamic, GET, runtime } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INTERNAL_ADMIN_EMAILS = "ops@taylslate.com";
  process.env.DOCUSIGN_ENV = "production";
  setResult({ count: 0, error: null });
});

describe("GET /api/admin/docusign-usage", () => {
  it("is a dynamic node route", () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns 401 when nobody is signed in, with no database call", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("returns 403 for a signed-in non-admin, with no database call", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1", email: "brand@example.com" });

    const res = await GET();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("returns the usage object for an admin", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "admin", email: "ops@taylslate.com" });
    setResult({ count: 12, error: null });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
    expect(supabaseAdmin.from).toHaveBeenCalledWith("domain_events");
    expect(body.used).toBe(12);
    expect(body.limit).toBe(40);
    expect(body.warnAt).toBe(35);
    expect(body.remaining).toBe(28);
    expect(body.state).toBe("ok");
    expect(body.environment).toBe("production");
    expect(typeof body.month).toBe("string");
  });

  it("returns 500 when the read fails, not a zero count", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "admin", email: "ops@taylslate.com" });
    setResult({ count: null, error: { message: "db down" } });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "Could not read DocuSign usage" });
    expect(body.used).toBeUndefined();
  });
});
