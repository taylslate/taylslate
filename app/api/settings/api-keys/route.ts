// Brand API keys. GET lists the allowlisted columns. POST creates one
// key and returns the secret once. brand id comes from the session.

import { createKey, listKeys } from "@/lib/api/keys";
import {
  apiKeyCreateRules,
  assertSameOrigin,
  assertUnderActiveCap,
  keySettingsErrorResponse,
  keySettingsJson,
  KeySettingsError,
  loadBrandKeySettings,
  readCreateBody,
  toApiKeyResponse,
} from "@/lib/api/key-settings";
import { enforceRules } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await loadBrandKeySettings();
    const keys = await listKeys(session.brandId);
    return keySettingsJson({ keys: keys.map(toApiKeyResponse) });
  } catch (err) {
    return keySettingsErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await loadBrandKeySettings();
    assertSameOrigin(request);
    if (!session.apiAccess) {
      throw new KeySettingsError(403, "API keys are part of the Operator plan.");
    }
    const input = await readCreateBody(request);
    const existing = await listKeys(session.brandId);
    assertUnderActiveCap(existing);
    const limited = await enforceRules({
      rules: apiKeyCreateRules(session.brandId),
      failureMode: "closed",
    });
    if (limited) return limited;

    const created = await createKey({
      brandId: session.brandId,
      name: input.name,
      scopes: input.scopes,
    });
    return keySettingsJson({
      key: toApiKeyResponse(created),
      secret: created.secret,
    });
  } catch (err) {
    return keySettingsErrorResponse(err);
  }
}
