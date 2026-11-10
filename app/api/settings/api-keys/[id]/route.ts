// Revoke one API key owned by the signed-in brand. A foreign id and an
// already revoked id are both 404.

import {
  apiKeyRevokeRules,
  assertSameOrigin,
  keySettingsErrorResponse,
  keySettingsJson,
  loadBrandKeySettings,
  revokeOwnedKey,
  toApiKeyResponse,
} from "@/lib/api/key-settings";
import { enforceRules } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await loadBrandKeySettings();
    assertSameOrigin(request);
    const limited = await enforceRules({
      rules: apiKeyRevokeRules(session.brandId),
      failureMode: "closed",
    });
    if (limited) return limited;

    const { id } = await context.params;
    const revoked = await revokeOwnedKey(session.brandId, id);
    return keySettingsJson({ key: toApiKeyResponse(revoked) });
  } catch (err) {
    return keySettingsErrorResponse(err);
  }
}
