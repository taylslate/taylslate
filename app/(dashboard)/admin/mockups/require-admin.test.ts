import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

import { requireMockupAdmin } from "./require-admin";

afterEach(() => {
  mocks.getAuthenticatedUser.mockReset();
  mocks.notFound.mockClear();
  delete process.env.INTERNAL_ADMIN_EMAILS;
});

describe("requireMockupAdmin", () => {
  it("404s when nobody is signed in", async () => {
    process.env.INTERNAL_ADMIN_EMAILS = "chris@taylslate.com";
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    await expect(requireMockupAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("404s for a signed-in user who is not an admin", async () => {
    process.env.INTERNAL_ADMIN_EMAILS = "chris@taylslate.com";
    mocks.getAuthenticatedUser.mockResolvedValue({ email: "brand@example.com" });
    await expect(requireMockupAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("lets an allowlisted admin through", async () => {
    process.env.INTERNAL_ADMIN_EMAILS = "chris@taylslate.com";
    mocks.getAuthenticatedUser.mockResolvedValue({ email: "Chris@taylslate.com" });
    await expect(requireMockupAdmin()).resolves.toBeUndefined();
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
