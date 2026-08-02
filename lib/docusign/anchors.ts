// Single source of truth for the DocuSign SignHere anchor strings.
//
// These EXACT strings are matched twice, in two different files, and MUST stay
// identical:
//   1. lib/docusign/envelope.ts renders a SignHere tab whose anchorString is one
//      of these, so DocuSign places the click-to-sign tab where the string is
//      found in the document.
//   2. lib/pdf/io-generator.ts must render these strings (as invisible white
//      text) at the signature lines so DocuSign has something to anchor to.
//
// Previously each file hard-coded its own copy; io-generator never actually
// rendered them, so every real IO envelope was created with NO signature tabs
// placed (DocuSign silently drops an anchor tab whose string it can't find).
// Keeping the strings here — imported by both sides — makes that drift
// impossible. This module is intentionally SDK-free (pure strings) so the PDF
// generator can import it without pulling in docusign-esign.

export const SIGNATURE_ANCHORS = {
  /** Brand / advertiser signer (routingOrder 1). */
  advertiser: "Advertiser Signature Tab",
  /** Show / publisher signer (routingOrder 2). */
  publisher: "Publisher Signature Tab",
} as const;
