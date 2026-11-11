import { beforeEach, describe, expect, it, vi } from "vitest";

const enforceRules = vi.fn();

vi.mock("@/lib/security/rate-limit", () => ({
  enforceRules: (...args: unknown[]) => enforceRules(...args),
  rateLimitClientIp: () => "203.0.113.5",
}));

import {
  YOUTUBE_IP_MAX,
  YOUTUBE_USER_MAX,
  enforceYoutubeCallback,
  enforceYoutubeConnect,
  enforceYoutubeDisconnect,
  enforceYoutubeStatus,
} from "./limits";

describe("youtube oauth rate limits", () => {
  beforeEach(() => {
    enforceRules.mockReset();
    enforceRules.mockResolvedValue(null);
  });

  it("limits each route per user and per IP and fails closed", async () => {
    const request = { headers: new Headers() };
    await enforceYoutubeConnect("user-1", request);
    await enforceYoutubeCallback("user-1", request);
    await enforceYoutubeDisconnect("user-1", request);
    await enforceYoutubeStatus("user-1", request);
    expect(enforceRules).toHaveBeenCalledTimes(4);
    const buckets = enforceRules.mock.calls.map((call) => {
      const input = call[0] as { failureMode: string; rules: { bucket: string; max: number; key: string }[] };
      expect(input.failureMode).toBe("closed");
      expect(input.rules[0]?.max).toBe(YOUTUBE_USER_MAX);
      expect(input.rules[0]?.max).toBe(10);
      expect(input.rules[1]?.max).toBe(YOUTUBE_IP_MAX);
      expect(input.rules[1]?.max).toBe(30);
      expect(input.rules[1]?.key).toBe("203.0.113.5");
      return input.rules[0]?.bucket;
    });
    expect(buckets).toEqual([
      "youtube_connect_user",
      "youtube_callback_user",
      "youtube_disconnect_user",
      "youtube_status_user",
    ]);
  });
});
