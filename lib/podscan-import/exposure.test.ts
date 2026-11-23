import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { serializeShow } from "@/lib/api/v1/serializers";

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "coverage",
  ".podscan-import",
  "out",
  "dist",
]);

const TEXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql", ".md", ".json"]);

function allowed(path: string): boolean {
  return (
    path.startsWith("lib/podscan-import/") ||
    path === "scripts/podscan-import.ts" ||
    path.startsWith("supabase/migrations/093_") ||
    path.startsWith("supabase/migrations/096_") ||
    path.startsWith("supabase/migrations/097_") ||
    path.startsWith("supabase/migrations/100_") ||
    path.startsWith("lib/ownership/") ||
    path.startsWith("docs/")
  );
}

async function walk(dir: string, root: string, hits: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, root, hits);
      continue;
    }
    const ext = entry.name.slice(entry.name.lastIndexOf("."));
    if (!TEXT.has(ext)) continue;
    const rel = relative(root, full).split("\\").join("/");
    if (allowed(rel)) continue;
    const text = await readFile(full, "utf8");
    if (/\b(podscan_catalog|show_contacts|podscan_audience_estimate)\b/.test(text)) {
      hits.push(rel);
    }
  }
}

describe("exposure", () => {
  it("does not treat brand_show_contacts as show_contacts", () => {
    expect("brand_show_contacts".match(/\bshow_contacts\b/)).toBeNull();
    expect(" show_contacts ".match(/\bshow_contacts\b/)).not.toBeNull();
  });

  it("leaves the internal estimate and an unlisted email out of serializeShow", () => {
    const json = JSON.stringify(
      serializeShow(
        {
          id: "show_1",
          name: "Example",
          podscan_audience_estimate: 424242,
          imported_email: "secret-import@sponsor.example",
          contact_email: "public@taylslate.com",
        },
        false
      )
    );
    expect(json).not.toContain("podscan_audience_estimate");
    expect(json).not.toContain("424242");
    expect(json).not.toContain("secret-import@sponsor.example");
    expect(json).toContain("public@taylslate.com");
  });

  it("keeps the new table names inside the import lane", async () => {
    const hits: string[] = [];
    await walk(process.cwd(), process.cwd(), hits);
    expect(hits).toEqual([]);
  });
});
