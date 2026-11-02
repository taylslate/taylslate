import { redactSecretParams } from "@/lib/discovery/redact-secrets";

/** Strip key query values, bearer tokens, and sk- secrets before a log or a row. */
export function redactAircheckError(message: string): string {
  return redactSecretParams(message)
    .replace(/bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "sk-[redacted]");
}
