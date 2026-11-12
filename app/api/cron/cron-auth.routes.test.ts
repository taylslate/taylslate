import { beforeEach, describe, expect, it, vi } from "vitest";

const work = vi.hoisted(() => ({
  alerts: vi.fn(),
  reminders: vi.fn(),
  cancels: vi.fn(),
  importPriors: vi.fn(),
  dealPriors: vi.fn(),
  pull: vi.fn(),
  refresh: vi.fn(),
  releases: vi.fn(),
}));

vi.mock("@/lib/analytics/gmv", () => ({
  getAllPaygCustomersAboveBreakeven: (...args: unknown[]) => work.alerts(...args),
}));

vi.mock("@/lib/data/queries", () => ({
  findStaleUnsignedDealsForReminder: (...args: unknown[]) => work.reminders(...args),
  findDealsToTimeoutCancel: (...args: unknown[]) => work.cancels(...args),
  getOutreachById: vi.fn(),
  updateWave12Deal: vi.fn(),
}));

vi.mock("@/lib/learning/pooled-priors", () => ({
  refreshPooledImportPriors: (...args: unknown[]) => work.importPriors(...args),
}));

vi.mock("@/lib/learning/pooled-deal-priors", () => ({
  refreshPooledDealPriors: (...args: unknown[]) => work.dealPriors(...args),
}));

vi.mock("@/lib/youtube-library/pull", () => ({
  runYoutubeLibraryPull: (...args: unknown[]) => work.pull(...args),
}));

vi.mock("@/lib/youtube-library/refresh", () => ({
  runYoutubeLibraryRefresh: (...args: unknown[]) => work.refresh(...args),
}));

vi.mock("@/lib/payouts/release", () => ({
  sweepHeldPayouts: (...args: unknown[]) => work.releases(...args),
}));

import { GET as conversionAlerts } from "@/app/api/cron/conversion-alerts/route";
import { GET as dealTimeouts } from "@/app/api/cron/deal-timeouts/route";
import { GET as pooledPriors } from "@/app/api/cron/pooled-priors/route";
import { GET as youtubePull } from "@/app/api/cron/youtube-library-pull/route";
import { GET as youtubeRefresh } from "@/app/api/cron/youtube-library-refresh/route";
import { GET as payoutReleases } from "@/app/api/cron/payout-releases/route";

const SECRET = "cron-secret";

function request(path: string, authorization?: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: authorization ? { authorization } : {},
  });
}

const routes = [
  {
    name: "conversion-alerts",
    path: "/api/cron/conversion-alerts",
    GET: conversionAlerts,
    called: () => work.alerts.mock.calls.length > 0,
  },
  {
    name: "deal-timeouts",
    path: "/api/cron/deal-timeouts",
    GET: dealTimeouts,
    called: () => work.reminders.mock.calls.length + work.cancels.mock.calls.length > 0,
  },
  {
    name: "pooled-priors",
    path: "/api/cron/pooled-priors",
    GET: pooledPriors,
    called: () => work.importPriors.mock.calls.length + work.dealPriors.mock.calls.length > 0,
  },
  {
    name: "youtube-library-pull",
    path: "/api/cron/youtube-library-pull",
    GET: youtubePull,
    called: () => work.pull.mock.calls.length > 0,
  },
  {
    name: "youtube-library-refresh",
    path: "/api/cron/youtube-library-refresh",
    GET: youtubeRefresh,
    called: () => work.refresh.mock.calls.length > 0,
  },
  {
    name: "payout-releases",
    path: "/api/cron/payout-releases",
    GET: payoutReleases,
    called: () => work.releases.mock.calls.length > 0,
  },
] as const;

describe("cron routes use isCronAuthorized", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    work.alerts.mockResolvedValue([]);
    work.reminders.mockResolvedValue([]);
    work.cancels.mockResolvedValue([]);
    work.importPriors.mockResolvedValue(0);
    work.dealPriors.mockResolvedValue(0);
    work.pull.mockResolvedValue({ ok: true });
    work.refresh.mockResolvedValue({ ok: true });
    work.releases.mockResolvedValue({ released: 0, held: 0, failed: 0 });
  });

  for (const route of routes) {
    it(`${route.name}: right token runs, wrong and missing tokens are 401`, async () => {
      const ok = await route.GET(request(route.path, `Bearer ${SECRET}`) as never);
      expect(ok.status).not.toBe(401);
      expect(route.called()).toBe(true);

      vi.clearAllMocks();
      const wrong = await route.GET(request(route.path, "Bearer cron-secreX") as never);
      expect(wrong.status).toBe(401);
      await expect(wrong.json()).resolves.toEqual({ error: "Unauthorized" });
      expect(route.called()).toBe(false);

      const missing = await route.GET(request(route.path) as never);
      expect(missing.status).toBe(401);
      await expect(missing.json()).resolves.toEqual({ error: "Unauthorized" });
      expect(route.called()).toBe(false);
    });
  }
});
