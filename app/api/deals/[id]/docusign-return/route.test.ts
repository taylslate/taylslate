import { describe, it, expect, vi, beforeEach } from "vitest";

// The return handler must be UX-only: bounce the signer back to the deal page,
// never touch deal state (the DocuSign Connect webhook is authoritative). We
// mock the write surfaces purely as a regression guard — if this route ever
// gains a DB write, these spies will fire and the "no writes" assertion fails.
const { supabaseAdmin, updateWave12Deal, logEvent } = vi.hoisted(() => ({
  supabaseAdmin: { from: vi.fn() },
  updateWave12Deal: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/data/queries", () => ({
  updateWave12Deal: (...a: unknown[]) => updateWave12Deal(...a),
}));
vi.mock("@/lib/data/events", () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

import { GET } from "./route";

const params = Promise.resolve({ id: "deal_1" });
function req(event?: string): Request {
  const qs = event === undefined ? "" : `?event=${event}`;
  return new Request(`https://www.taylslate.com/api/deals/deal_1/docusign-return${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.taylslate.com/";
});

describe("GET /api/deals/[id]/docusign-return", () => {
  it("redirects back to the deal page carrying the signing event", async () => {
    const res = await GET(req("signing_complete") as never, { params });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://www.taylslate.com/deals/deal_1?signing=signing_complete"
    );
  });

  it("defaults to signing=unknown when DocuSign sends no event", async () => {
    const res = await GET(req() as never, { params });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://www.taylslate.com/deals/deal_1?signing=unknown"
    );
  });

  it("url-encodes the event value into the redirect", async () => {
    const res = await GET(req("ttl_expired") as never, { params });
    expect(res.headers.get("location")).toBe(
      "https://www.taylslate.com/deals/deal_1?signing=ttl_expired"
    );
  });

  it("performs NO database writes — it is UX-only (webhook is authoritative)", async () => {
    await GET(req("signing_complete") as never, { params });
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(updateWave12Deal).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });
});
