// DocuSign JWT-grant client. Server-to-server auth — no user OAuth dance.
//
// Token TTL is 1 hour from DocuSign; we cache it in-memory with a 5-minute
// safety margin. On a fresh cold start the SDK fetches a new token.
//
// IMPORTANT: docusign-esign is loaded via require(), not import. The SDK
// uses AMD/UMD-style modules that Turbopack can't bundle, so we keep it
// out of the dependency graph and resolve at runtime.

export type DocuSignEnv = "sandbox" | "production";

// Avoid `any` in the public surface by type-aliasing the runtime client.
// The wrapper interface for the bits we actually call is in envelope.ts.
type DocuSignApiClient = {
  setBasePath(p: string): void;
  setOAuthBasePath(p: string): void;
  addDefaultHeader(name: string, value: string): void;
  requestJWTUserToken(
    integrationKey: string,
    userId: string,
    scopes: string[],
    privateKey: Buffer,
    expiresIn: number
  ): Promise<{ body: { access_token: string; expires_in: number } }>;
};

function loadSdk(): { ApiClient: new () => DocuSignApiClient } {
  // Turbopack tries to statically analyze and bundle docusign-esign even with
  // serverExternalPackages set, and the SDK's UMD/AMD wrappers break the
  // bundler. Hiding the require() behind (0, eval) makes the module fully
  // opaque so the bundler ignores it; Node.js resolves it at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requireFn = (0, eval)("require") as (id: string) => unknown;
  return requireFn("docusign-esign") as { ApiClient: new () => DocuSignApiClient };
}

function getEnv(): DocuSignEnv {
  return (process.env.DOCUSIGN_ENV ?? "sandbox") as DocuSignEnv;
}

function getOAuthBasePath(): string {
  return getEnv() === "production"
    ? "account.docusign.com"
    : "account-d.docusign.com";
}

function getRestBasePath(): string {
  return getEnv() === "production"
    ? `https://www.docusign.net/restapi`
    : `https://demo.docusign.net/restapi`;
}

function normalizePrivateKey(raw: string): Buffer {
  // Vercel strips real newlines; env vars often arrive with literal "\n".
  const withNewlines = raw.replace(/\\n/g, "\n");
  return Buffer.from(withNewlines, "utf8");
}

interface TokenCache {
  accessToken: string;
  expiresAt: number; // unix seconds
}

let cachedToken: TokenCache | null = null;

async function fetchAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 300 > now) {
    return cachedToken.accessToken;
  }

  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
  const userId = process.env.DOCUSIGN_USER_ID;
  const rsaKey = process.env.DOCUSIGN_RSA_PRIVATE_KEY;
  if (!integrationKey || !userId || !rsaKey) {
    throw new Error(
      "DocuSign JWT auth missing env vars (DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, DOCUSIGN_RSA_PRIVATE_KEY)"
    );
  }

  const sdk = loadSdk();
  const api = new sdk.ApiClient();
  api.setOAuthBasePath(getOAuthBasePath());

  const { body } = await api.requestJWTUserToken(
    integrationKey,
    userId,
    ["signature", "impersonation"],
    normalizePrivateKey(rsaKey),
    3600
  );
  const token = body.access_token;
  const expiresIn = Number(body.expires_in ?? 3600);
  cachedToken = { accessToken: token, expiresAt: now + expiresIn };
  return token;
}

/**
 * Returns a configured ApiClient with a fresh access token bound. Callers
 * read `accountId` from the same return value — do NOT hardcode it per call.
 */
export async function getDocuSignClient(): Promise<{
  api: DocuSignApiClient;
  accountId: string;
  sdk: ReturnType<typeof loadSdk> & Record<string, unknown>;
}> {
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  if (!accountId) throw new Error("DOCUSIGN_ACCOUNT_ID not set");
  const accessToken = await fetchAccessToken();

  const sdk = loadSdk() as ReturnType<typeof loadSdk> & Record<string, unknown>;
  const api = new sdk.ApiClient();
  api.setBasePath(getRestBasePath());
  api.addDefaultHeader("Authorization", `Bearer ${accessToken}`);
  return { api, accountId, sdk };
}

/** Test helper — clears the in-memory token cache. */
export function _resetDocuSignTokenCache(): void {
  cachedToken = null;
}
