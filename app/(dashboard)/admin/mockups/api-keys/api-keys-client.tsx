"use client";

import { useState } from "react";
import {
  API_KEYS,
  API_SCOPES,
  formatDay,
  labelOf,
  type MockApiKey,
} from "../fixtures";
import {
  MockupPage,
  StatusPill,
  fieldClass,
  ghostButtonClass,
  labelClass,
  mockupCard,
  mockupMuted,
  mockupRadius,
  primaryButtonClass,
} from "../chrome";

function scopeLabel(id: string): string {
  return API_SCOPES.find((scope) => scope.id === id)?.label ?? id;
}

export function ApiKeysClient() {
  const [keys, setKeys] = useState<MockApiKey[]>(() => API_KEYS.map((key) => ({ ...key, scopes: [...key.scopes] })));
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [secretOnce, setSecretOnce] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleScope(id: string) {
    setScopes((current) =>
      current.includes(id) ? current.filter((scope) => scope !== id) : [...current, id],
    );
  }

  function createKey(event: React.FormEvent) {
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
    const serial = String(keys.length + 1).padStart(2, "0");
    const secret = `ts_mock_${serial}_7k3m9q`;
    setKeys((current) => [
      {
        id: `key-local-${serial}`,
        name: trimmed,
        scopes: [...scopes],
        prefix: `${secret.slice(0, 14)}...`,
        lastUsed: null,
        status: "active",
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]);
    setSecretOnce(secret);
    setName("");
    setScopes([]);
    setError(null);
  }

  return (
    <MockupPage
      kicker="API keys"
      title="API keys"
      lede="Operator accounts can hold keys. The full secret is shown once, then only the prefix remains."
    >
      <form onSubmit={createKey} className={`${mockupCard} space-y-3`} style={mockupRadius}>
        <h2 className="text-lg font-semibold">Create a key</h2>
        <div>
          <label className={labelClass} htmlFor="key-name">
            Name
          </label>
          <input
            id="key-name"
            className={fieldClass}
            style={mockupRadius}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <fieldset>
          <legend className={labelClass}>Scopes</legend>
          <div className="space-y-2">
            {API_SCOPES.map((scope) => (
              <label key={scope.id} className="flex items-center gap-2 text-sm" htmlFor={`scope-${scope.id}`}>
                <input
                  id={`scope-${scope.id}`}
                  type="checkbox"
                  checked={scopes.includes(scope.id)}
                  onChange={() => toggleScope(scope.id)}
                />
                <span>
                  {scope.label} <span className={mockupMuted}>({scope.id})</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {error ? <p className="text-sm text-[var(--ts-accent-text)]">{error}</p> : null}
        <button type="submit" className={primaryButtonClass} style={mockupRadius}>
          Create key
        </button>
      </form>

      {secretOnce ? (
        <div
          className={`${mockupCard} mt-4`}
          style={mockupRadius}
          role="status"
          data-testid="api-key-secret"
        >
          <p className="font-medium">Copy this key now. It will not be shown again.</p>
          <p className="mt-2 font-mono text-sm">{secretOnce}</p>
          <button
            type="button"
            className={`${ghostButtonClass} mt-3`}
            style={mockupRadius}
            onClick={() => setSecretOnce(null)}
          >
            Hide key
          </button>
        </div>
      ) : null}

      <ul className="mt-6 space-y-3">
        {keys.map((key) => (
          <li key={key.id} className={mockupCard} style={mockupRadius}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{key.name}</p>
                <p className={`mt-1 font-mono text-sm ${mockupMuted}`}>{key.prefix}</p>
                <p className={`mt-2 ${mockupMuted}`}>
                  {key.scopes.map(scopeLabel).join(", ")}
                </p>
                <p className={`mt-2 ${mockupMuted}`}>
                  {key.lastUsed ? `Last used ${formatDay(key.lastUsed)}` : "Not used yet"}
                </p>
                <p className="mt-2">
                  <StatusPill>{labelOf(key.status)}</StatusPill>
                </p>
              </div>
              {key.status === "active" ? (
                <button
                  type="button"
                  className={ghostButtonClass}
                  style={mockupRadius}
                  onClick={() =>
                    setKeys((current) =>
                      current.map((item) =>
                        item.id === key.id ? { ...item, status: "revoked" } : item,
                      ),
                    )
                  }
                >
                  Revoke {key.name}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </MockupPage>
  );
}
