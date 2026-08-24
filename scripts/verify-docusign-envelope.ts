#!/usr/bin/env npx tsx
// ============================================================
// VERIFY: One real DocuSign sandbox envelope, end to end.
// Run: npx tsx scripts/verify-docusign-envelope.ts [--redirect <uri>]
//
// Exercises the REAL lib/docusign code — client.ts JWT auth (requestJWTUserToken)
// + envelope.ts createEnvelope / getBrandSigningUrl — against the sandbox API.
// This is the path the 1021-test suite only ever MOCKS, and that the DocuSign
// dashboard shows has never executed (0 API calls on the integration key).
//
// First run typically FAILS at JWT auth with `consent_required` and prints a
// one-time admin-consent URL, then exits 0. Grant consent in the browser as the
// sandbox user, then re-run to mint the envelope.
//
// On success: creates ONE envelope (status "sent") with two signer emails, then
// prints the envelopeId and the embedded brand signing URL. Does NOT configure
// DocuSign Connect or verify the webhook (deferred by design this session).
//
// Read/writes: makes ONE createEnvelope REST call (+ one recipient-view call)
// against the DocuSign sandbox. Touches nothing in Supabase, no app config.
// ============================================================

// Load .env.local exactly the way the running Next app does — this is the only
// loader that preserves the multi-line quoted RSA PEM intact (the naive
// line-splitting parser used by the other scripts would corrupt it).
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createRequire } from "node:module";
// The DocuSign SDK is loaded via (0,eval)("require") because its UMD module
// breaks the bundler (see lib/docusign/client.ts). Under tsx's ESM loader there
// is no global `require`, so provide one. The Next.js runtime already has it —
// this shim only exists for running the loader standalone.
(globalThis as Record<string, unknown>).require ??= createRequire(import.meta.url);

import { jsPDF } from "jspdf";
// Relative imports (not "@/…") — tsx does not read tsconfig path aliases;
// matches the convention in verify-podscan-email-fill.ts.
import { getDocuSignClient } from "../lib/docusign/client";
import { createEnvelope, getBrandSigningUrl } from "../lib/docusign/envelope";

// ---- Config ----
const BRAND_EMAIL = "chris@taylslate.com";
const BRAND_NAME = "Chris Taylor (Brand)";
const SHOW_EMAIL = "chris+show@taylslate.com";
const SHOW_NAME = "Chris Taylor (Show)";
const OAUTH_HOST = "account-d.docusign.com"; // sandbox
const SCOPES = "signature impersonation";

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function isConsentRequired(err: unknown): boolean {
  const e = err as {
    message?: string;
    response?: { body?: unknown; data?: unknown; text?: unknown };
  };
  const haystack = [
    e?.message,
    typeof e?.response?.body === "string"
      ? e.response.body
      : JSON.stringify(e?.response?.body ?? ""),
    typeof e?.response?.data === "string"
      ? e.response.data
      : JSON.stringify(e?.response?.data ?? ""),
    typeof e?.response?.text === "string" ? e.response.text : "",
  ]
    .filter(Boolean)
    .join(" | ");
  return /consent_required/i.test(haystack);
}

function buildConsentUrl(integrationKey: string, redirectUri: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    scope: SCOPES,
    client_id: integrationKey,
    redirect_uri: redirectUri,
  });
  return `https://${OAUTH_HOST}/oauth/auth?${params.toString()}`;
}

function buildTestPdf(): Buffer {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setFontSize(16);
  doc.text("Taylslate — DocuSign Sandbox Verification", 72, 80);
  doc.setFontSize(10);
  doc.text(
    "Throwaway test document to mint one real sandbox envelope.",
    72,
    108
  );
  doc.text("This is NOT a real insertion order.", 72, 124);

  // The real createEnvelope places SignHere tabs by anchor string
  // (envelope.ts: ANCHOR_BRAND / ANCHOR_SHOW). Render those exact strings so
  // the tabs resolve. NOTE: the production IO generator (io-generator.ts) does
  // NOT render these strings — flagged separately.
  doc.text("Advertiser Signature Tab", 72, 320);
  doc.text("Publisher Signature Tab", 72, 440);

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}

async function main(): Promise<void> {
  const redirectUri =
    getArg("--redirect") ?? "https://developers.docusign.com/platform/auth/consent";

  console.log("=== DocuSign sandbox envelope verification ===");
  console.log(`DOCUSIGN_ENV = ${process.env.DOCUSIGN_ENV ?? "(unset → sandbox)"}`);

  // Safety: this throwaway script creates a real, sent envelope to hard-coded
  // recipients. Refuse to run against production so a stray DOCUSIGN_ENV can
  // never fire a live envelope.
  const dsEnv = process.env.DOCUSIGN_ENV;
  if (dsEnv && dsEnv !== "sandbox") {
    console.error(
      `\nRefusing to run against DOCUSIGN_ENV="${dsEnv}". This verification script targets the sandbox only. Unset DOCUSIGN_ENV or set it to "sandbox".`
    );
    process.exit(1);
  }

  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
  const required = [
    "DOCUSIGN_INTEGRATION_KEY",
    "DOCUSIGN_USER_ID",
    "DOCUSIGN_ACCOUNT_ID",
    "DOCUSIGN_RSA_PRIVATE_KEY",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  // --- Step 1: JWT auth (the never-run client.ts path) ---
  console.log("\n[1/3] Requesting JWT user token…");
  let accountId: string;
  try {
    const client = await getDocuSignClient();
    accountId = client.accountId;
    console.log(`      OK — token acquired. accountId=${accountId}`);
  } catch (err) {
    if (isConsentRequired(err)) {
      const url = buildConsentUrl(integrationKey!, redirectUri);
      console.log("\n      → consent_required (expected on first run).");
      console.log(
        "      Grant one-time admin consent in a browser as the sandbox user, then re-run:\n"
      );
      console.log(url);
      console.log(
        "\n      (redirect_uri must be registered on the integration key; the code returned is ignored.)"
      );
      process.exit(0);
    }
    console.error("\n      JWT auth failed (not consent_required):");
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // --- Step 2: build the test PDF ---
  console.log("\n[2/3] Building minimal test PDF (with signature anchors)…");
  const pdfBuffer = buildTestPdf();
  console.log(`      OK — ${pdfBuffer.length} bytes.`);

  // --- Step 3: mint exactly ONE envelope ---
  console.log("\n[3/3] Creating ONE envelope via real createEnvelope…");
  const created = await createEnvelope({
    pdfBuffer,
    documentName: "taylslate-docusign-verification.pdf",
    emailSubject: "Taylslate — DocuSign sandbox verification (test)",
    brand: { name: BRAND_NAME, email: BRAND_EMAIL },
    show: { name: SHOW_NAME, email: SHOW_EMAIL },
  });
  console.log(`      OK — envelopeId = ${created.envelopeId}`);

  // Embedded brand signing URL (brand is a clientUserId recipient → no email;
  // sign via this recipient-view URL).
  const signing = await getBrandSigningUrl({
    envelopeId: created.envelopeId,
    signer: { name: BRAND_NAME, email: BRAND_EMAIL, clientUserId: "brand" },
    returnUrl: "https://www.taylslate.com/",
  });

  console.log("\n=== SUCCESS: one real sandbox envelope created ===");
  console.log(`envelopeId:        ${created.envelopeId}`);
  console.log(`brand (embedded):  ${BRAND_EMAIL}`);
  console.log(`show (email r.o.2): ${SHOW_EMAIL}`);
  console.log("\nBrand signing URL (open to sign the brand side in-browser):");
  console.log(signing.url);
  console.log(
    "\nVerify in the sandbox: https://apps-d.docusign.com/ → your account → Sent."
  );
}

main().catch((err) => {
  console.error("\nUnexpected failure:");
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
