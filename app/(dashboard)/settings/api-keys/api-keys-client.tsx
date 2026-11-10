"use client";

import Link from "next/link";
import { useState } from "react";
import { tokens } from "@/lib/brand/tokens";

const radiusStyle = { borderRadius: tokens.radius };

const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const panelClass = "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]";
const inkBtnClass =
  "inline-flex items-center bg-[var(--ts-accent)] px-4 py-2 text-sm font-medium text-[var(--ts-accent-foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtnClass =
  "inline-flex items-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)] disabled:cursor-not-allowed disabled:opacity-50";
const fieldClass =
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none disabled:bg-[var(--ts-band-shows)] disabled:text-[var(--ts-ink-muted-on-paper)]";
const labelClass = "mb-1.5 block text-sm font-medium text-[var(--ts-ink-on-paper)]";
const kickerClass =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]";

const SCOPE_OPTIONS = [
  { id: "read", label: "Read shows, campaigns, deals and actions" },
  {
    id: "write:campaigns",
    label: "Propose campaigns. Each one waits for your approval.",
  },
  {
    id: "write:outreach",
    label: "Propose outreach. Each one waits for your approval. Nothing is sent.",
  },
] as const;

type ScopeId = (typeof SCOPE_OPTIONS)[number]["id"];

export interface ApiKeyListItem {
  id: string;
  name: string | null;
  prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function scopeLabel(id: string): string {
  return SCOPE_OPTIONS.find((scope) => scope.id === id)?.label ?? id;
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function prefixText(prefix: string): string {
  return prefix.startsWith("ts_live_") ? prefix : `ts_live_${prefix}`;
}

async function readJson(res: Response): Promise<{ error?: unknown; key?: ApiKeyListItem; secret?: unknown; keys?: ApiKeyListItem[] } | null> {
  try {
    return (await res.json()) as {
      error?: unknown;
      key?: ApiKeyListItem;
      secret?: unknown;
      keys?: ApiKeyListItem[];
    };
  } catch {
    return null;
  }
}

function allowKey(value: ApiKeyListItem): ApiKeyListItem {
  return {
    id: value.id,
    name: value.name ?? null,
    prefix: value.prefix,
    scopes: Array.isArray(value.scopes) ? [...value.scopes] : [],
    created_at: value.created_at,
    last_used_at: value.last_used_at ?? null,
    revoked_at: value.revoked_at ?? null,
  };
}

function errorText(payload: { error?: unknown } | null, fallback: string): string {
  return typeof payload?.error === "string" && payload.error ? payload.error : fallback;
}

export function ApiKeysClient({
  initialKeys,
  apiAccess,
  loadError = false,
}: {
  initialKeys: ApiKeyListItem[];
  apiAccess: boolean;
  loadError?: boolean;
}) {
  const [keys, setKeys] = useState<ApiKeyListItem[]>(initialKeys);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ScopeId[]>([]);
  const [secretOnce, setSecretOnce] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  function toggleScope(id: ScopeId) {
    setScopes((current) =>
      current.includes(id) ? current.filter((scope) => scope !== id) : [...current, id]
    );
  }

  async function createKey(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    if (scopes.length === 0) {
      setError("Choose at least one scope.");
      return;
    }
    setPending(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed, scopes }),
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = await readJson(res);
      const created = payload?.key ? allowKey(payload.key) : null;
      if (!res.ok || !created || typeof payload?.secret !== "string" || !payload.secret) {
        setError(errorText(payload, "API key request failed."));
        return;
      }
      setKeys((current) => [created, ...current.filter((key) => key.id !== created.id)]);
      setSecretOnce(payload.secret);
      setName("");
      setScopes([]);
    } catch {
      setError("API key request failed.");
    } finally {
      setPending(false);
    }
  }

  async function copySecret() {
    if (!secretOnce) return;
    try {
      await navigator.clipboard.writeText(secretOnce);
      setCopied(true);
    } catch {
      setCopied(false);
      setError("Could not copy. Select the key and copy it.");
    }
  }

  async function revoke(id: string) {
    setRevokingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/settings/api-keys/${id}`, {
        method: "DELETE",
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = await readJson(res);
      const revoked = payload?.key ? allowKey(payload.key) : null;
      if (!res.ok || !revoked) {
        setError(errorText(payload, "API key request failed."));
        return;
      }
      setKeys((current) => current.map((key) => (key.id === id ? revoked : key)));
      setConfirmId(null);
    } catch {
      setError("API key request failed.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="max-w-2xl p-4 sm:p-8">
      <p className={kickerClass}>For brands</p>
      <h1 className={`mt-2 text-2xl font-semibold tracking-tight ${inkText}`}>API keys</h1>
      <p className={`mb-8 mt-1 text-sm ${mutedText}`}>
        Operator accounts can hold keys. The full secret is shown once, then only the prefix remains.
      </p>

      {apiAccess ? (
        <form onSubmit={createKey} className={`mb-6 space-y-3 p-5 ${panelClass}`} style={radiusStyle}>
          <h2 className={`font-semibold ${inkText}`}>Create a key</h2>
          <div>
            <label className={labelClass} htmlFor="key-name">
              Name
            </label>
            <input
              id="key-name"
              className={fieldClass}
              style={radiusStyle}
              value={name}
              maxLength={60}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <fieldset>
            <legend className={labelClass}>Scopes</legend>
            <div className="space-y-2">
              {SCOPE_OPTIONS.map((scope) => (
                <label key={scope.id} className={`flex items-center gap-2 text-sm ${inkText}`} htmlFor={`scope-${scope.id.replace(":", "-")}`}>
                  <input
                    id={`scope-${scope.id.replace(":", "-")}`}
                    type="checkbox"
                    checked={scopes.includes(scope.id)}
                    onChange={() => toggleScope(scope.id)}
                  />
                  <span>{scope.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" className={inkBtnClass} style={radiusStyle} disabled={pending}>
            {pending ? "Creating..." : "Create key"}
          </button>
        </form>
      ) : (
        <div className={`mb-6 p-5 ${panelClass}`} style={radiusStyle}>
          <p className={`text-sm ${inkText}`}>
            API keys are part of the Operator plan.{" "}
            <Link href="/settings/billing" className="underline">
              Billing
            </Link>
          </p>
        </div>
      )}

      {secretOnce ? (
        <div
          className={`mb-6 p-5 ${panelClass}`}
          style={radiusStyle}
          role="status"
          data-testid="api-key-secret"
        >
          <p className={`font-medium ${inkText}`}>Copy this key now. It will not be shown again.</p>
          <input
            className={`${fieldClass} mt-2 font-mono`}
            style={radiusStyle}
            readOnly
            value={secretOnce}
            aria-label="API key"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={ghostBtnClass} style={radiusStyle} onClick={copySecret}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              className={ghostBtnClass}
              style={radiusStyle}
              onClick={() => {
                setSecretOnce(null);
                setCopied(false);
              }}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}

      {loadError ? (
        <p className="mb-4 text-sm text-[var(--ts-accent-text)]">API keys could not be loaded.</p>
      ) : null}

      {error ? (
        <p className="mb-4 text-sm text-[var(--ts-accent-text)]" role="alert">
          {error}
        </p>
      ) : null}

      {keys.length === 0 ? (
        <p className={`mb-4 text-sm ${mutedText}`}>No keys yet.</p>
      ) : (
        <ul className="mb-4 space-y-3">
          {keys.map((key) => {
            const revoked = key.revoked_at != null;
            const label = key.name?.trim() || "Untitled";
            return (
              <li key={key.id} className={`p-5 ${panelClass}`} style={radiusStyle}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className={`font-medium ${inkText}`}>{label}</p>
                    <p className={`mt-1 font-mono text-sm ${mutedText}`}>{prefixText(key.prefix)}</p>
                    <p className={`mt-2 text-sm ${mutedText}`}>
                      {key.scopes.map(scopeLabel).join(", ")}
                    </p>
                    <p className={`mt-2 text-sm ${mutedText}`}>Created {formatDay(key.created_at)}</p>
                    <p className={`mt-1 text-sm ${mutedText}`}>
                      Last used {key.last_used_at ? formatDay(key.last_used_at) : "Never"}
                    </p>
                    <p className={`mt-2 text-sm ${inkText}`}>{revoked ? "Revoked" : "Active"}</p>
                  </div>
                  {!revoked && confirmId !== key.id ? (
                    <button
                      type="button"
                      className={ghostBtnClass}
                      style={radiusStyle}
                      onClick={() => setConfirmId(key.id)}
                    >
                      Revoke {label}
                    </button>
                  ) : null}
                  {!revoked && confirmId === key.id ? (
                    <div className="space-y-2">
                      <p className={`text-sm ${inkText}`}>Revoke this key? It stops working immediately.</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={inkBtnClass}
                          style={radiusStyle}
                          disabled={revokingId === key.id}
                          onClick={() => revoke(key.id)}
                        >
                          {revokingId === key.id ? "Revoking..." : "Revoke key"}
                        </button>
                        <button
                          type="button"
                          className={ghostBtnClass}
                          style={radiusStyle}
                          onClick={() => setConfirmId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className={`text-sm ${mutedText}`}>
        Actions your keys propose wait in{" "}
        <Link href="/settings/agent-actions" className="underline">
          Agent actions
        </Link>
        .
      </p>
    </div>
  );
}
