import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import {
  PUBLIC_PAGES,
  SITE_ORIGIN,
  absoluteUrl,
  marketingPages,
  publicMetadata,
} from "./site";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function isClientModule(src: string): boolean {
  return /^\s*["']use client["']/m.test(src);
}

describe("public page metadata", () => {
  it("gives every public shell page an absolute www canonical", () => {
    expect(PUBLIC_PAGES.map((page) => page.path)).toEqual([
      "/",
      "/for-shows",
      "/terms",
      "/privacy",
      "/login",
      "/signup",
      "/forgot-password",
      "/reset-password",
      "/auth/magic",
    ]);

    for (const page of PUBLIC_PAGES) {
      const metadata = publicMetadata(page.path);
      expect(metadata.alternates?.canonical).toBe(absoluteUrl(page.path));
      expect(absoluteUrl(page.path).startsWith("https://www.taylslate.com")).toBe(
        true,
      );
      expect(metadata.description).toBe(page.description);
      expect(metadata.title).toEqual({ absolute: page.title });
      const metaSrc = read(page.metadataFile);
      expect(isClientModule(metaSrc)).toBe(false);
      expect(metaSrc).toContain(`publicMetadata("${page.path}")`);
    }
  });

  it("server-renders marketing pages with Open Graph tags and a sitemap entry", () => {
    const pages = marketingPages();
    expect(pages.map((page) => page.path)).toEqual(["/", "/for-shows"]);

    for (const page of pages) {
      expect(isClientModule(read(page.pageFile))).toBe(false);
      const metadata = publicMetadata(page.path);
      expect(metadata.robots).toEqual({ index: true, follow: true });
      expect(metadata.openGraph).toMatchObject({
        title: page.title,
        description: page.description,
        url: absoluteUrl(page.path),
        siteName: "Taylslate",
        type: "website",
      });
      expect(metadata.twitter).toMatchObject({
        card: "summary_large_image",
        title: page.title,
        description: page.description,
      });
    }

    expect(isClientModule(read("components/marketing/launch-home.tsx"))).toBe(
      false,
    );
    expect(isClientModule(read("components/marketing/shows-home.tsx"))).toBe(
      false,
    );
    expect(isClientModule(read("components/marketing/product-shot.tsx"))).toBe(
      false,
    );

    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual(pages.map((page) => absoluteUrl(page.path)));
    expect(urls).toEqual([SITE_ORIGIN, `${SITE_ORIGIN}/for-shows`]);
    const home = pages[0];
    expect(home?.description).not.toMatch(/January 2027/);
    expect(publicMetadata("/").description).toBe(
      "Find shows worth testing, score the fit, build the media plan, and pay the host when the read runs.",
    );
  });

  it("keeps auth pages out of the sitemap and out of the index", () => {
    for (const page of PUBLIC_PAGES.filter((entry) => !entry.marketing)) {
      expect(publicMetadata(page.path).robots).toEqual({
        index: false,
        follow: true,
      });
      expect(publicMetadata(page.path).openGraph).toBeUndefined();
    }
    expect(sitemap().some((entry) => entry.url.includes("/login"))).toBe(false);
  });

  it("points robots.txt at the www sitemap", () => {
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/" },
      sitemap: `${SITE_ORIGIN}/sitemap.xml`,
      host: SITE_ORIGIN,
    });
  });
});
