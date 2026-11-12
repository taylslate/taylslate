import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const admin = vi.fn();
const limit = vi.fn();
const detail = vi.fn();
const approve = vi.fn();
const reject = vi.fn();

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: () => auth(),
}));

vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin: (...args: unknown[]) => admin(...args),
}));

vi.mock("@/lib/security/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security/rate-limit")>("@/lib/security/rate-limit");
  return { ...actual, enforceRules: (...args: unknown[]) => limit(...args) };
});

vi.mock("@/lib/ownership/review", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ownership/review")>("@/lib/ownership/review");
  return {
    ...actual,
    getOwnershipDetail: (...args: unknown[]) => detail(...args),
    approveOwnershipProof: (...args: unknown[]) => approve(...args),
    rejectOwnershipProof: (...args: unknown[]) => reject(...args),
  };
});

import { GET, POST } from "./route";

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROOF = "44444444-4444-4444-8444-444444444444";

function call(
  method: "GET" | "POST",
  id: string,
  body?: unknown,
  headers?: Headers,
  origin: string | null = "https://www.taylslate.com"
): Promise<Response> {
  const requestHeaders = headers ?? new Headers({ "content-type": "application/json" });
  if (method === "POST" && origin) requestHeaders.set("origin", origin);
  return (method === "GET" ? GET : POST)(
    new NextRequest(`https://www.taylslate.com/api/admin/ownership/${id}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

describe("GET and POST /api/admin/ownership/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.taylslate.com";
    auth.mockResolvedValue({ id: ADMIN });
    admin.mockResolvedValue(true);
    limit.mockResolvedValue(null);
    detail.mockResolvedValue({
      ok: true,
      detail: { proof: { id: PROOF }, other_proofs: [], rep_links: [] },
    });
    approve.mockResolvedValue({ ok: true });
    reject.mockResolvedValue({ ok: true });
  });

  it("returns 403 when the POST origin is missing or cross-site", async () => {
    const missing = await call("POST", PROOF, { action: "approve" }, undefined, null);
    expect(missing.status).toBe(403);
    expect(await missing.json()).toEqual({ error: "Forbidden" });
    expect(missing.headers.get("Cache-Control")).toBe("no-store");

    const other = await call("POST", PROOF, { action: "approve" }, undefined, "https://evil.example");
    expect(other.status).toBe(403);
    expect(await other.json()).toEqual({ error: "Forbidden" });
    expect(approve).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();

    const read = await call("GET", PROOF, undefined, undefined, null);
    expect(read.status).toBe(200);
    expect(detail).toHaveBeenCalled();
  });

  it("returns 401 and 403 with no-store", async () => {
    auth.mockResolvedValueOnce(null);
    const signedOut = await call("GET", PROOF);
    expect(signedOut.status).toBe(401);
    expect(signedOut.headers.get("Cache-Control")).toBe("no-store");
    expect(await signedOut.json()).toEqual({ error: "Unauthorized" });

    admin.mockResolvedValueOnce(false);
    const forbidden = await call("POST", PROOF, { action: "approve" });
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("Cache-Control")).toBe("no-store");
    expect(approve).not.toHaveBeenCalled();
  });

  it("returns 429 and a closed 503", async () => {
    limit.mockResolvedValueOnce(
      NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { "Retry-After": "60" } })
    );
    const limited = await call("POST", PROOF, { action: "approve" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Cache-Control")).toBe("no-store");
    expect(approve).not.toHaveBeenCalled();

    limit.mockResolvedValueOnce(NextResponse.json({ error: "unavailable" }, { status: 503 }));
    const closed = await call("GET", PROOF);
    expect(closed.status).toBe(503);
    expect(closed.headers.get("Cache-Control")).toBe("no-store");
    expect(detail).not.toHaveBeenCalled();
  });

  it("returns 413 and 415", async () => {
    const plain = await call("POST", PROOF, "hello", new Headers({ "content-type": "text/plain" }));
    expect(plain.status).toBe(415);
    expect(await plain.json()).toEqual({ error: "Request body must be JSON." });
    expect(plain.headers.get("Cache-Control")).toBe("no-store");

    const big = await call("POST", PROOF, { action: "approve", pad: "x".repeat(9000) });
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: "Request body is too large." });
    expect(big.headers.get("Cache-Control")).toBe("no-store");
    expect(approve).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad id and 404 for an unknown id", async () => {
    const bad = await call("GET", "not-a-uuid");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Bad request." });
    expect(detail).not.toHaveBeenCalled();

    detail.mockResolvedValueOnce({ ok: false, status: 404, error: "Not found" });
    const missing = await call("GET", PROOF);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Not found" });
    expect(missing.headers.get("Cache-Control")).toBe("no-store");
  });

  it("approves with the session admin id and hides a database message", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    const ok = await call("POST", PROOF, { action: "approve", decided_by: "attacker-id", user_id: "other" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, status: "verified" });
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
    expect(approve).toHaveBeenCalledWith({ proofId: PROOF, adminId: ADMIN });

    approve.mockResolvedValueOnce({ ok: false, status: 409, error: "Already decided" });
    const lost = await call("POST", PROOF, { action: "approve" });
    expect(lost.status).toBe(409);
    expect(await lost.json()).toEqual({ error: "Already decided" });

    approve.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: "This show already has a verified owner.",
    });
    const clash = await call("POST", PROOF, { action: "approve" });
    expect(clash.status).toBe(409);

    approve.mockResolvedValueOnce({ ok: false, status: 500, error: "duplicate key secret-db-text " + PROOF });
    const leaked = await call("POST", PROOF, { action: "approve" });
    expect(leaked.status).toBe(500);
    const leakedBody = await leaked.json();
    expect(leakedBody).toEqual({ error: "Couldn't approve that proof." });
    expect(JSON.stringify(leakedBody)).not.toContain(PROOF);
    expect(logs.join("\n")).not.toContain("secret-db-text");
    expect(logs.join("\n")).not.toContain(PROOF);
  });

  it("rejects with a reason and refuses a missing reason", async () => {
    reject.mockResolvedValueOnce({ ok: false, status: 400, error: "A reason of 1 to 500 characters is required." });
    const missing = await call("POST", PROOF, { action: "reject" });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "A reason of 1 to 500 characters is required." });
    expect(reject).toHaveBeenCalledWith({ proofId: PROOF, adminId: ADMIN, reason: undefined });

    reject.mockResolvedValueOnce({ ok: false, status: 400, error: "A reason of 1 to 500 characters is required." });
    const long = await call("POST", PROOF, { action: "reject", reason: "n".repeat(501), decided_by: "attacker-id" });
    expect(long.status).toBe(400);
    expect(reject).toHaveBeenLastCalledWith({
      proofId: PROOF,
      adminId: ADMIN,
      reason: "n".repeat(501),
    });

    const ok = await call("POST", PROOF, { action: "reject", reason: "The feed does not match." });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, status: "rejected" });
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
  });
});
