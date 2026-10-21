import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Fraunces: () => ({ variable: "--font-app-display", className: "font-display" }),
  Figtree: () => ({ variable: "--font-app-sans", className: "font-body" }),
}));
import {
  getRedirectStatusCodeFromError,
  getURLFromRedirectError,
} from "next/dist/client/components/redirect";
import Home from "./page";

async function redirectFrom(value: string | string[] | undefined) {
  try {
    await Home({ searchParams: Promise.resolve({ for: value }) });
  } catch (error) {
    return error;
  }
  return null;
}

function asRedirect(error: unknown) {
  expect(error).toBeTruthy();
  return error as Parameters<typeof getURLFromRedirectError>[0];
}

describe("home /?for=shows", () => {
  it("308-redirects /?for=shows to /#shows", async () => {
    const error = asRedirect(await redirectFrom("shows"));
    expect(getURLFromRedirectError(error)).toBe("/#shows");
    expect(getRedirectStatusCodeFromError(error)).toBe(308);
  });

  it("308-redirects a repeated for=shows param", async () => {
    const error = asRedirect(await redirectFrom(["shows", "brands"]));
    expect(getURLFromRedirectError(error)).toBe("/#shows");
    expect(getRedirectStatusCodeFromError(error)).toBe(308);
  });

  it("renders the home page for any other for value", async () => {
    expect(await redirectFrom(undefined)).toBeNull();
    expect(await redirectFrom("brands")).toBeNull();
    expect(await redirectFrom("")).toBeNull();
  });
});
