import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Compute the full transitive dependency closure of an installed npm package and
// return outputFileTracing globs for the package plus every dependency.
//
// Why this is needed: lib/docusign/client.ts and lib/stripe/server.ts load their
// UMD SDKs through an opaque `new Function("require", …)` call. That opacity is
// deliberate — a statically visible require makes Turbopack try to bundle the
// SDKs' AMD/UMD wrappers and fail the build (TP1200). But the same opacity hides
// the packages from Next's file tracer, so Vercel would NOT pack them into the
// serverless bundle → runtime "Cannot find module 'docusign-esign'". These globs
// force the package AND its deps into the bundle. Computed from node_modules at
// build time so a dependency bump can't silently drop a transitive package.
//
// Flat (npm) node_modules layout assumed — verified via package-lock.json + real
// dirs (no pnpm store). A `**/*` glob on each package also sweeps in any nested
// node_modules, so a non-hoisted transitive is still covered.
function tracePackageClosure(rootPkg: string): string[] {
  const nodeModules = join(process.cwd(), "node_modules");
  const seen = new Set<string>();
  const stack = [rootPkg];
  while (stack.length) {
    const name = stack.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    try {
      const pkg = JSON.parse(
        readFileSync(join(nodeModules, name, "package.json"), "utf8")
      ) as { dependencies?: Record<string, string> };
      for (const dep of Object.keys(pkg.dependencies ?? {})) stack.push(dep);
    } catch {
      // Package not resolvable at the root (optional dep, or nested under a
      // parent's node_modules — in which case the parent's `**/*` glob covers
      // it). A genuinely missing runtime dep surfaces as a clear "Cannot find
      // module" and can be added explicitly.
    }
  }
  return [...seen].map((name) => `./node_modules/${name}/**/*`);
}

const externalSdkTracing = [
  ...tracePackageClosure("docusign-esign"),
  ...tracePackageClosure("stripe"),
];

const nextConfig: NextConfig = {
  // The docusign-esign and Stripe SDKs use UMD-style requires Turbopack can't
  // bundle, so they're marked server-external and loaded at runtime. See
  // lib/docusign/client.ts and lib/stripe/server.ts for the createRequire +
  // opaque `new Function` loader (NOT (0, eval)("require") — that threw
  // "require is not defined" in the ESM server bundle).
  serverExternalPackages: ["docusign-esign", "stripe"],
  outputFileTracingIncludes: {
    // Markdown prompt files (lib/prompts/*.md) are read with fs at runtime
    // (see lib/llm/client.ts loadPrompt). Force them into the serverless
    // bundle — static file tracing can't see through the dynamic path join.
    "/**": ["./lib/prompts/*.md"],
    // Force the opaque-loaded SDKs + their transitive closures into the API
    // route bundles that load them (docusign: send-to-docusign, cancel,
    // webhooks/docusign, cron/deal-timeouts; stripe: setup-intent + stripe/*).
    // Broad key so a future route that loads either SDK is covered without
    // editing this list.
    "/api/**": externalSdkTracing,
  },
};

export default nextConfig;
