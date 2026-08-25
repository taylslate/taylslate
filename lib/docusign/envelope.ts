// DocuSign envelope creation + hosted signing URL.
//
// Two-signer flow with explicit routing order:
//   routing 1 — brand (advertiser)   — signs first
//   routing 2 — show (publisher)     — countersigns
//
// We attach SignHere and DateSigned anchor tabs keyed off invisible text we
// render at the signature and date lines in the PDF (see io-generator.ts and the
// shared strings in anchors.ts). DocuSign finds those strings and places the
// click-to-sign tab and the auto-stamped completion date over them, no fixed
// pixel coordinates needed.
//
// IMPORTANT: docusign-esign uses AMD/UMD modules that Turbopack can't bundle.
// We resolve everything from the SDK at runtime via getDocuSignClient (which
// require()s the SDK lazily).

import { getDocuSignClient } from "./client";
import { SIGNATURE_ANCHORS } from "./anchors";

/* eslint-disable @typescript-eslint/no-explicit-any */
type SdkAny = any;

export interface CreateEnvelopeInput {
  /** PDF bytes for the IO. */
  pdfBuffer: Buffer;
  /** Filename shown in the DocuSign UI (e.g., "io-IO-ABC1234.pdf"). */
  documentName: string;
  /** Subject line of the DocuSign-sent email. */
  emailSubject: string;
  /** Brand-side signer (signs first). */
  brand: { name: string; email: string };
  /** Show-side signer (countersigns). */
  show: { name: string; email: string };
}

export interface CreatedEnvelope {
  envelopeId: string;
}

export interface SigningUrlInput {
  envelopeId: string;
  signer: { name: string; email: string; clientUserId: string };
  /** Where DocuSign returns the user after signing. */
  returnUrl: string;
}

export interface SigningUrl {
  url: string;
}

const ANCHOR_BRAND = SIGNATURE_ANCHORS.advertiser;
const ANCHOR_SHOW = SIGNATURE_ANCHORS.publisher;
const ANCHOR_BRAND_DATE = SIGNATURE_ANCHORS.advertiserDate;
const ANCHOR_SHOW_DATE = SIGNATURE_ANCHORS.publisherDate;

// Recipient ids — single source shared by createEnvelope, the signing-URL view,
// and the post-create tab-placement backstop so they can never drift.
const RECIPIENT_BRAND = "1";
const RECIPIENT_SHOW = "2";

interface BuildSignerOpts {
  name: string;
  email: string;
  routingOrder: string;
  recipientId: string;
  anchorString: string;
  /** Anchor for the DateSigned tab (rendered on the date line in the PDF). */
  dateAnchorString: string;
  /** If set, enables embedded signing for this recipient. */
  clientUserId?: string;
}

function buildSigner(sdk: SdkAny, opts: BuildSignerOpts): SdkAny {
  const signer = sdk.Signer.constructFromObject({
    email: opts.email,
    name: opts.name,
    recipientId: opts.recipientId,
    routingOrder: opts.routingOrder,
  });
  if (opts.clientUserId) signer.clientUserId = opts.clientUserId;

  const signHere = sdk.SignHere.constructFromObject({
    anchorString: opts.anchorString,
    anchorUnits: "pixels",
    anchorXOffset: "0",
    anchorYOffset: "-12",
  });
  // DateSigned auto-stamps the completion date when THIS recipient signs. Anchored
  // to the date-line string (same yOffset convention as SignHere → the value sits
  // just above its line). Placed beside/under the signature per the PDF layout,
  // never off-page — the publisher block is in the right column, so a rightward
  // x-offset would overflow; the date line below is the safe, labeled home.
  const dateSigned = sdk.DateSigned.constructFromObject({
    anchorString: opts.dateAnchorString,
    anchorUnits: "pixels",
    anchorXOffset: "0",
    anchorYOffset: "-12",
  });
  signer.tabs = sdk.Tabs.constructFromObject({
    signHereTabs: [signHere],
    dateSignedTabs: [dateSigned],
  });
  return signer;
}

export async function createEnvelope(
  input: CreateEnvelopeInput
): Promise<CreatedEnvelope> {
  const { api, accountId, sdk: sdkRaw } = await getDocuSignClient();
  const sdk = sdkRaw as SdkAny;
  const envelopesApi = new sdk.EnvelopesApi(api);

  const document = sdk.Document.constructFromObject({
    documentBase64: input.pdfBuffer.toString("base64"),
    name: input.documentName,
    fileExtension: "pdf",
    documentId: "1",
  });

  const brandSigner = buildSigner(sdk, {
    name: input.brand.name,
    email: input.brand.email,
    routingOrder: "1",
    recipientId: RECIPIENT_BRAND,
    anchorString: ANCHOR_BRAND,
    dateAnchorString: ANCHOR_BRAND_DATE,
    clientUserId: "brand",
  });

  const showSigner = buildSigner(sdk, {
    name: input.show.name,
    email: input.show.email,
    routingOrder: "2",
    recipientId: RECIPIENT_SHOW,
    anchorString: ANCHOR_SHOW,
    dateAnchorString: ANCHOR_SHOW_DATE,
  });

  const recipients = sdk.Recipients.constructFromObject({
    signers: [brandSigner, showSigner],
  });

  const envelopeDefinition = sdk.EnvelopeDefinition.constructFromObject({
    emailSubject: input.emailSubject,
    documents: [document],
    recipients,
    status: "sent",
  });

  const result = await envelopesApi.createEnvelope(accountId, {
    envelopeDefinition,
  });
  if (!result.envelopeId) {
    throw new Error("DocuSign createEnvelope returned no envelopeId");
  }
  return { envelopeId: result.envelopeId };
}

export interface TabPlacementResult {
  /** True when every recipient has at least one resolved SignHere tab. */
  ok: boolean;
  /** Recipient ids that came back with no placed SignHere tab. */
  missing: string[];
  /** Set when the check itself failed (throw/timeout); `ok` is false. */
  error?: string;
}

/**
 * Log-only backstop for the anchor-tab bug: after createEnvelope, confirm
 * DocuSign actually RESOLVED the SignHere anchors. An unmatched anchor is
 * silently dropped, producing a "sent" envelope with no signature fields — the
 * exact failure that shipped once. This reads back the tabs DocuSign placed.
 *
 * NEVER throws and is time-bounded: a failure here must not affect the signer
 * flow. Callers run it off the response path (Next `after()`) and log a domain
 * event on `!ok`. Returns `{ ok:false }` (never rejects) if listTabs throws or
 * the check exceeds `timeoutMs` — the caller decides what to do with that.
 */
export async function verifyEnvelopeTabsPlaced(
  envelopeId: string,
  timeoutMs = 8000
): Promise<TabPlacementResult> {
  // Strict scalar → finite number. Rejects null/undefined/""/whitespace, booleans,
  // arrays, and objects so a malformed tab with blank/absent coordinates is NOT
  // coerced to 0 and mistaken for a resolved tab (DocuSign returns positions as
  // numeric strings when an anchor actually resolves).
  const finiteNum = (v: unknown): number | null => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  // Never rejects: any error becomes a structured, non-fatal result.
  const check = async (): Promise<TabPlacementResult> => {
    try {
      const { api, accountId, sdk: sdkRaw } = await getDocuSignClient();
      const sdk = sdkRaw as SdkAny;
      const envelopesApi = new sdk.EnvelopesApi(api);
      const recipientIds = [RECIPIENT_BRAND, RECIPIENT_SHOW];
      const results = await Promise.all(
        recipientIds.map(async (rid) => {
          const tabs = await envelopesApi.listTabs(accountId, envelopeId, rid);
          const signHere = (tabs?.signHereTabs ?? []) as Array<Record<string, unknown>>;
          const placed = signHere.some((t) => {
            const page = finiteNum(t.pageNumber);
            const x = finiteNum(t.xPosition);
            const yPos = finiteNum(t.yPosition);
            return page !== null && page >= 1 && x !== null && yPos !== null;
          });
          return { rid, placed };
        })
      );
      const missing = results.filter((r) => !r.placed).map((r) => r.rid);
      return { ok: missing.length === 0, missing };
    } catch (err) {
      return {
        ok: false,
        missing: [],
        error: err instanceof Error ? err.message : "unknown",
      };
    }
  };

  // Time-bound the check; the timeout RESOLVES (never rejects) to a sentinel so
  // no unhandled rejection can leak from the losing race branch.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TabPlacementResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, missing: [], error: `tab check timed out after ${timeoutMs}ms` }),
      timeoutMs
    );
  });
  const outcome = await Promise.race([check(), timeout]);
  if (timer) clearTimeout(timer);
  return outcome;
}

export async function getBrandSigningUrl(input: SigningUrlInput): Promise<SigningUrl> {
  const { api, accountId, sdk: sdkRaw } = await getDocuSignClient();
  const sdk = sdkRaw as SdkAny;
  const envelopesApi = new sdk.EnvelopesApi(api);

  const viewRequest = sdk.RecipientViewRequest.constructFromObject({
    authenticationMethod: "none",
    clientUserId: input.signer.clientUserId,
    recipientId: RECIPIENT_BRAND,
    returnUrl: input.returnUrl,
    userName: input.signer.name,
    email: input.signer.email,
  });

  const view = await envelopesApi.createRecipientView(accountId, input.envelopeId, {
    recipientViewRequest: viewRequest,
  });
  if (!view.url) throw new Error("DocuSign createRecipientView returned no url");
  return { url: view.url };
}

/** Void an envelope. Idempotent: voiding an already-completed envelope
 *  returns 400; we swallow that case and never throw. */
export async function voidEnvelope(
  envelopeId: string,
  reason: string
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { api, accountId, sdk: sdkRaw } = await getDocuSignClient();
    const sdk = sdkRaw as SdkAny;
    const envelopesApi = new sdk.EnvelopesApi(api);
    await envelopesApi.update(accountId, envelopeId, {
      envelope: sdk.Envelope.constructFromObject({
        status: "voided",
        voidedReason: reason,
      }),
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.warn("[docusign.voidEnvelope] non-fatal:", message);
    return { ok: false, reason: message };
  }
}

/** Download the completed (signed) PDF for an envelope. */
export async function downloadCompletedDocument(envelopeId: string): Promise<Buffer> {
  const { api, accountId, sdk: sdkRaw } = await getDocuSignClient();
  const sdk = sdkRaw as SdkAny;
  const envelopesApi = new sdk.EnvelopesApi(api);
  const result = await envelopesApi.getDocument(accountId, envelopeId, "combined");
  return Buffer.isBuffer(result) ? result : Buffer.from(result as ArrayBufferLike);
}

/** Download the certificate of completion (audit trail). */
export async function downloadCertificate(envelopeId: string): Promise<Buffer> {
  const { api, accountId, sdk: sdkRaw } = await getDocuSignClient();
  const sdk = sdkRaw as SdkAny;
  const envelopesApi = new sdk.EnvelopesApi(api);
  const result = await envelopesApi.getDocument(accountId, envelopeId, "certificate");
  return Buffer.isBuffer(result) ? result : Buffer.from(result as ArrayBufferLike);
}
