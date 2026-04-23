import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  classifyEvent,
  parseDocuSignEvent,
  verifyDocuSignSignature,
} from "./webhook";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

const SECRET = "test_docusign_webhook_secret";

describe("verifyDocuSignSignature", () => {
  it("accepts a correctly signed payload", () => {
    const body = '{"hello":"world"}';
    const sig = sign(body, SECRET);
    expect(verifyDocuSignSignature(body, sig, SECRET)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const body = '{"hello":"world"}';
    const sig = sign(body, SECRET);
    expect(verifyDocuSignSignature('{"hello":"evil"}', sig, SECRET)).toBe(false);
  });

  it("rejects when secret is missing", () => {
    const body = '{"hello":"world"}';
    expect(verifyDocuSignSignature(body, "anything", undefined)).toBe(false);
  });

  it("rejects when header is missing", () => {
    expect(verifyDocuSignSignature("{}", null, SECRET)).toBe(false);
  });
});

describe("parseDocuSignEvent", () => {
  it("extracts envelopeId, status, and signed timestamps", () => {
    const payload = {
      event: "envelope-completed",
      data: {
        envelopeId: "env-1",
        envelopeSummary: {
          status: "completed",
          recipients: {
            signers: [
              { recipientId: "1", signedDateTime: "2026-04-23T12:00:00Z" },
              { recipientId: "2", signedDateTime: "2026-04-24T08:00:00Z" },
            ],
          },
        },
      },
    };
    const evt = parseDocuSignEvent(payload);
    expect(evt?.envelopeId).toBe("env-1");
    expect(evt?.envelopeStatus).toBe("completed");
    expect(evt?.recipientSignedAt["1"]).toBe("2026-04-23T12:00:00Z");
    expect(evt?.recipientSignedAt["2"]).toBe("2026-04-24T08:00:00Z");
  });

  it("returns null when envelopeId is missing", () => {
    expect(parseDocuSignEvent({ event: "x" })).toBeNull();
  });
});

describe("classifyEvent", () => {
  it("flags envelope completed", () => {
    const action = classifyEvent({
      event: "envelope-completed",
      envelopeId: "e1",
      envelopeStatus: "completed",
      recipientSignedAt: { "2": "2026-04-24T08:00:00Z" },
    });
    expect(action.kind).toBe("completed");
  });

  it("flags voided", () => {
    const action = classifyEvent({
      event: "envelope-voided",
      envelopeId: "e1",
      envelopeStatus: "voided",
      voidedReason: "brand cancelled",
      recipientSignedAt: {},
    });
    expect(action).toEqual({ kind: "voided", reason: "brand cancelled" });
  });

  it("flags brand-only signature", () => {
    const action = classifyEvent({
      event: "recipient-completed",
      envelopeId: "e1",
      envelopeStatus: "sent",
      recipientSignedAt: { "1": "2026-04-23T12:00:00Z" },
    });
    expect(action.kind).toBe("brand_signed");
  });

  it("flags show countersignature", () => {
    const action = classifyEvent({
      event: "recipient-completed",
      envelopeId: "e1",
      envelopeStatus: "sent",
      recipientSignedAt: {
        "1": "2026-04-23T12:00:00Z",
        "2": "2026-04-24T08:00:00Z",
      },
    });
    expect(action.kind).toBe("show_signed");
  });

  it("ignores unrelated events", () => {
    const action = classifyEvent({
      event: "envelope-resent",
      envelopeId: "e1",
      envelopeStatus: "sent",
      recipientSignedAt: {},
    });
    expect(action.kind).toBe("ignored");
  });
});
