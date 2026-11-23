import { describe, expect, it, vi } from "vitest";

const stored = [
  {
    id: "show-1",
    name: "Recovery Lab",
    platform: "podcast",
    slug: "recovery-lab",
    ownership_status: "verified",
    data_sources: ["show_owner"],
    contact_email: "host@show.test",
  },
];

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from() {
      const api: Record<string, unknown> = {};
      const self = () => api;
      api.select = self;
      api.in = self;
      api.then = (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown
      ) => Promise.resolve({ data: stored, error: null }).then(resolve, reject);
      return api;
    },
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => ({}) }),
}));

import { getShowsBySlugs } from "./queries";

describe("getShowsBySlugs", () => {
  it("copies ownership_status from the raw row for scoring", async () => {
    const [show] = await getShowsBySlugs(["recovery-lab"]);
    expect(show.slug).toBe("recovery-lab");
    expect(show.ownership_status).toBe("verified");
    expect(show.data_sources).toEqual(["show_owner"]);
    expect(show.contact.email).toBe("host@show.test");
  });
});
