import { describe, expect, it } from "vitest";
import { hashKey } from "@/lib/api/keys";
import { hashToken, newAccessToken, newAuthCode, newClientId, newRefreshToken } from "./tokens";

describe("oauth token formats", () => {
  it("issues prefixed secrets and stores only the sha256 hex", () => {
    const access = newAccessToken();
    const refresh = newRefreshToken();
    const code = newAuthCode();
    const clientId = newClientId();
    expect(access).toMatch(/^ts_oat_[0-9a-f]{64}$/);
    expect(refresh).toMatch(/^ts_ort_[0-9a-f]{64}$/);
    expect(code).toMatch(/^tsac_[0-9a-f]{64}$/);
    expect(clientId).toMatch(/^tsc_[0-9a-f]{32}$/);
    expect(hashToken(access)).toBe(hashKey(access));
    expect(hashToken(access)).not.toContain(access);
    expect(hashToken(access)).toMatch(/^[0-9a-f]{64}$/);
    expect(newAccessToken()).not.toBe(access);
  });
});
