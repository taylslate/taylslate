// DocuSign envelope creation + hosted signing URL.
//
// Two-signer flow with explicit routing order:
//   routing 1 — brand (advertiser)   — signs first
//   routing 2 — show (publisher)     — countersigns
//
// We attach SignHere anchor tabs keyed off invisible text we render at the
// signature lines in the PDF (see io-generator.ts: "Signature" labels). DocuSign
// finds those strings and places the click-to-sign tab over them, no fixed
// pixel coordinates needed.
//
// IMPORTANT: docusign-esign uses AMD/UMD modules that Turbopack can't bundle.
// We resolve everything from the SDK at runtime via getDocuSignClient (which
// require()s the SDK lazily).

import { getDocuSignClient } from "./client";

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

const ANCHOR_BRAND = "Advertiser Signature Tab";
const ANCHOR_SHOW = "Publisher Signature Tab";

interface BuildSignerOpts {
  name: string;
  email: string;
  routingOrder: string;
  recipientId: string;
  anchorString: string;
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
  signer.tabs = sdk.Tabs.constructFromObject({ signHereTabs: [signHere] });
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
    recipientId: "1",
    anchorString: ANCHOR_BRAND,
    clientUserId: "brand",
  });

  const showSigner = buildSigner(sdk, {
    name: input.show.name,
    email: input.show.email,
    routingOrder: "2",
    recipientId: "2",
    anchorString: ANCHOR_SHOW,
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

export async function getBrandSigningUrl(input: SigningUrlInput): Promise<SigningUrl> {
  const { api, accountId, sdk: sdkRaw } = await getDocuSignClient();
  const sdk = sdkRaw as SdkAny;
  const envelopesApi = new sdk.EnvelopesApi(api);

  const viewRequest = sdk.RecipientViewRequest.constructFromObject({
    authenticationMethod: "none",
    clientUserId: input.signer.clientUserId,
    recipientId: "1",
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
