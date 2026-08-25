// DocuSign JWT-grant client. Server-to-server auth — no user OAuth dance.
//
// Token TTL is 1 hour from DocuSign; we cache it in-memory with a 5-minute
// safety margin. On a fresh cold start the SDK fetches a new token.
//
// IMPORTANT: docusign-esign is a CommonJS/UMD package Turbopack can't bundle, so
// it's marked serverExternal (next.config.ts) and loaded with a real runtime
// require. We use createRequire(import.meta.url) — NOT (0, eval)("require") —
// because Turbopack emits this as an ESM server module with no global `require`
// binding, so the eval form throws "require is not defined" at runtime.

import { createRequire } from "node:module";

export type DocuSignEnv = "sandbox" | "production";

// Node's own CommonJS require, bound to this module's URL. Independent of any
// global `require`, so it resolves docusign-esign correctly inside the ESM
// server bundle (where an indirect eval("require") finds nothing).
const nodeRequire = createRequire(import.meta.url);

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
  getUserInfo(accessToken: string): Promise<{
    accounts?: Array<{
      accountId?: string;
      isDefault?: string;
      baseUri?: string;
    }>;
  }>;
};

function loadSdk(): { ApiClient: new () => DocuSignApiClient } {
  // Load through a Function whose body Turbopack cannot statically analyze, so it
  // never traces docusign-esign's AMD/UMD wrapper — Turbopack chokes on its
  // define() form (TP1200) even with serverExternalPackages set. We inject
  // `nodeRequire` (a real createRequire-based require) as the parameter, so the
  // load does NOT depend on a global `require`, which the ESM server bundle lacks
  // (that absence is what made the old (0, eval)("require") throw at runtime).
  // serverExternalPackages still guarantees the package ships in node_modules for
  // createRequire to resolve.
  const load = new Function("require", "return require('docusign-esign')") as (
    r: (id: string) => unknown
  ) => unknown;
  return load(nodeRequire) as { ApiClient: new () => DocuSignApiClient };
}

function getEnv(): DocuSignEnv {
  return (process.env.DOCUSIGN_ENV ?? "sandbox") as DocuSignEnv;
}

function getOAuthBasePath(): string {
  return getEnv() === "production"
    ? "account.docusign.com"
    : "account-d.docusign.com";
}

function normalizePrivateKey(raw: string): Buffer {
  // Vercel strips real newlines; env vars often arrive with literal "\n".
  const withNewlines = raw.replace(/\\n/g, "\n");
  return Buffer.from(withNewlines, "utf8");
}

const USERINFO_TIMEOUT_MS = 10_000;

// Race a promise against a timeout that rejects. Used to bound the getUserInfo
// discovery hop so a hung OAuth host can't stall envelope creation indefinitely.
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface TokenCache {
  accessToken: string;
  expiresAt: number; // unix seconds
  // Region-specific REST base discovered from the account's base_uri, e.g.
  // "https://na4.docusign.net/restapi". Cached with the token (both refresh together).
  restBasePath: string;
}

let cachedToken: TokenCache | null = null;

async function fetchAuth(): Promise<{ accessToken: string; restBasePath: string }> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 300 > now) {
    return {
      accessToken: cachedToken.accessToken,
      restBasePath: cachedToken.restBasePath,
    };
  }

  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
  const userId = process.env.DOCUSIGN_USER_ID;
  const rsaKey = process.env.DOCUSIGN_RSA_PRIVATE_KEY;
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  if (!integrationKey || !userId || !rsaKey || !accountId) {
    throw new Error(
      "DocuSign JWT auth missing env vars (DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, DOCUSIGN_RSA_PRIVATE_KEY, DOCUSIGN_ACCOUNT_ID)"
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

  // Discover the account's region-specific base_uri (e.g. https://na4.docusign.net)
  // instead of hardcoding a host. Region-bound accounts (na4, eu1, au1, …) MUST call
  // their own base_uri — a generic www.docusign.net fails for them. getUserInfo hits
  // the OAuth host set above and returns the correct base_uri for both sandbox and prod.
  //
  // Bound the call: it's an extra network hop on the envelope-creation path and the
  // SDK sets no timeout on getUserInfo, so a slow OAuth host would otherwise stall the
  // send indefinitely. Cap it and let a clear error surface fast instead.
  const userInfo = await withTimeout(
    api.getUserInfo(token),
    USERINFO_TIMEOUT_MS,
    "DocuSign getUserInfo"
  );
  // Resolve STRICTLY by the configured account. Do not fall back to the default
  // account's base_uri: pairing one account's host with a different configured
  // accountId silently targets the wrong data center (fails only later, downstream).
  const accounts = userInfo?.accounts ?? [];
  const account = accounts.find((a) => a.accountId === accountId);
  if (!account?.baseUri) {
    throw new Error(
      `DocuSign getUserInfo returned no base_uri for account ${accountId} ` +
        `(user ${userId} may not be a member of it)`
    );
  }
  // Trim any trailing slash before appending /restapi (defensive against a future
  // host-format change) so we never build a "…net//restapi" double slash.
  const restBasePath = `${account.baseUri.replace(/\/+$/, "")}/restapi`;
  cachedToken = { accessToken: token, expiresAt: now + expiresIn, restBasePath };
  return { accessToken: token, restBasePath };
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
  const { accessToken, restBasePath } = await fetchAuth();

  const sdk = loadSdk() as ReturnType<typeof loadSdk> & Record<string, unknown>;
  const api = new sdk.ApiClient();
  api.setBasePath(restBasePath);
  api.addDefaultHeader("Authorization", `Bearer ${accessToken}`);
  return { api, accountId, sdk };
}

/** Test helper — clears the in-memory token cache. */
export function _resetDocuSignTokenCache(): void {
  cachedToken = null;
}
