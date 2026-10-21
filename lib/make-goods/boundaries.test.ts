import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function sourceOf(dir: string): string {
  const chunks: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      chunks.push(sourceOf(full));
      continue;
    }
    if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      chunks.push(stripComments(readFileSync(full, "utf8")));
    }
  }
  return chunks.join("\n");
}

describe("make-good boundaries", () => {
  const root = process.cwd();
  const makeGoods = sourceOf(path.join(root, "lib/make-goods"));
  const routes = sourceOf(path.join(root, "app/api/deals/[id]/make-goods"));
  const aircheckHook = stripComments(
    readFileSync(path.join(root, "lib/airchecks/detect.ts"), "utf8")
  );

  it("does not trust show_profiles.podscan_id", () => {
    expect(makeGoods).not.toMatch(/podscan_id/);
    expect(routes).not.toMatch(/podscan_id/);
    expect(aircheckHook).not.toMatch(/podscan_id/);
    expect(makeGoods).toMatch(/show_id/);
    expect(makeGoods).toMatch(/show_profile_id/);
  });

  it("does not charge, email, or send DocuSign", () => {
    const combined = `${makeGoods}\n${routes}\n${aircheckHook}`;
    expect(combined).not.toMatch(/lib\/stripe|lib\/payouts|lib\/billing|lib\/docusign|lib\/email/);
    expect(combined).not.toMatch(/chargeForEpisode|createEnvelope|sendEmail/);
  });
});
