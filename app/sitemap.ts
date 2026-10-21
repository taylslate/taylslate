import type { MetadataRoute } from "next";
import { absoluteUrl, marketingPages } from "@/lib/marketing/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return marketingPages().map((page) => ({
    url: absoluteUrl(page.path),
    changeFrequency: "weekly",
    priority: 1,
  }));
}
