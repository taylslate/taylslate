import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

import ShowLoginPage from "./page";

describe("Show login redirect", () => {
  it("sends /login/show to the shared code login", async () => {
    await expect(ShowLoginPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "REDIRECT /login",
    );
  });

  it("keeps a same-origin next path on the code login", async () => {
    await expect(
      ShowLoginPage({ searchParams: Promise.resolve({ next: "/deals/1" }) }),
    ).rejects.toThrow("REDIRECT /login?next=%2Fdeals%2F1");
  });

  it("drops an open redirect", async () => {
    await expect(
      ShowLoginPage({ searchParams: Promise.resolve({ next: "//evil.com" }) }),
    ).rejects.toThrow("REDIRECT /login?next=%2Fdashboard");
  });
});
