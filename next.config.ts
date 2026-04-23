import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The docusign-esign SDK uses UMD-style relative requires that Turbopack
  // can't resolve. Marking it server-external forces Node.js's require to
  // load it at runtime instead of bundling it.
  serverExternalPackages: ["docusign-esign"],
};

export default nextConfig;
