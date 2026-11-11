import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function filesIn(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...filesIn(full));
      continue;
    }
    if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function valueImportsStripe(source: string): boolean {
  const stripped = stripComments(source).replace(
    /import\s+type\s+[\s\S]*?from\s+["'][^"']+["'];?/g,
    ""
  );
  const withoutTypeOnly = stripped.replace(
    /import\s*\{([^}]*)\}\s*from\s+["']([^"']+)["'];?/g,
    (statement, body: string, specifier: string) => {
      if (!specifier.includes("/lib/stripe")) return statement;
      const values = body
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((part) => !part.startsWith("type "));
      return values.length === 0 ? "" : statement;
    }
  );
  return /@\/lib\/stripe|lib\/stripe/.test(withoutTypeOnly);
}

describe("aircheck charge boundaries", () => {
  const root = process.cwd();
  const airchecksDir = path.join(root, "lib/airchecks");
  const cronRoute = path.join(root, "app/api/cron/airchecks/route.ts");
  const reviewPath = path.join(airchecksDir, "review.ts");
  const runPath = path.join(airchecksDir, "run.ts");
  const others = filesIn(airchecksDir).filter((file) => file !== reviewPath);

  it("keeps the charge path out of every aircheck file except review", () => {
    const banned =
      /from\s+["'](?:\.\/review|@\/lib\/airchecks\/review)["']|lib\/delivery\/mark-delivered|lib\/stripe|lib\/payouts|lib\/billing|chargeForEpisode|deliverAndChargeLine/;
    for (const file of others) {
      const source = stripComments(readFileSync(file, "utf8"));
      expect(source, file).not.toMatch(banned);
    }
    const cron = stripComments(readFileSync(cronRoute, "utf8"));
    expect(cron).not.toMatch(banned);
  });

  it("does not let review import payouts, billing, or a stripe value", () => {
    const review = readFileSync(reviewPath, "utf8");
    const code = stripComments(review);
    expect(code).not.toMatch(/lib\/payouts|lib\/billing/);
    expect(valueImportsStripe(review)).toBe(false);
    expect(code).toMatch(/import type \{ ChargeForEpisodeResult \}/);
    expect(code).toMatch(/deliverAndChargeLine/);
  });

  it("does not let the cron route or the runner write a review or a delivery", () => {
    for (const file of [cronRoute, runPath]) {
      const source = stripComments(readFileSync(file, "utf8"));
      expect(source, file).not.toMatch(/review_decision|decided_by|verified/);
    }
  });
});
