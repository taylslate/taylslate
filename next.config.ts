import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The docusign-esign SDK and the Stripe SDK both use UMD-style relative
  // requires that Turbopack can't resolve. Marking them server-external
  // forces Node.js's require to load them at runtime instead of bundling.
  // See lib/docusign/client.ts and lib/stripe/server.ts for the matching
  // (0, eval)("require") loader pattern.
  serverExternalPackages: ["docusign-esign", "stripe"],
};

export default nextConfig;
