"use client";

import { useState } from "react";
import { tokens } from "@/lib/brand/tokens";
import type { ManagedBrandRow } from "@/lib/accounts/managed";

const radiusStyle = { borderRadius: tokens.radius };
const inkBtn =
  "inline-flex items-center bg-[var(--ts-ink-on-paper)] px-3 py-1.5 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtn =
  "inline-flex items-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-1.5 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)] disabled:cursor-not-allowed disabled:opacity-50";

export default function ManagedBrandsClient({
  brands,
}: {
  brands: ManagedBrandRow[];
}) {
  const [rows, setRows] = useState(brands);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(row: ManagedBrandRow) {
    setPendingId(row.id);
    setError(null);
    try {
      const res = await fetch("/api/admin/managed-brands", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: row.id, isManaged: !row.isManaged }),
      });
      const body = (await res.json()) as { isManaged?: boolean; error?: string };
      if (!res.ok || typeof body.isManaged !== "boolean") {
        setError(body.error ?? "Couldn't update that brand");
        return;
      }
      setRows((current) =>
        current.map((item) =>
          item.id === row.id ? { ...item, isManaged: body.isManaged as boolean } : item,
        ),
      );
    } catch {
      setError("Couldn't update that brand");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="max-w-2xl p-4 sm:p-8">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--ts-accent)]">
        Internal
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--ts-ink-on-paper)]">
        Managed brands
      </h1>
      <p className="mt-2 text-sm text-[var(--ts-ink-muted-on-paper)]">
        Chris runs these accounts. Taylslate does not email them or send DocuSign
        for them. Login links still go to the real address.
      </p>

      {error && (
        <p className="mt-4 text-sm text-[var(--ts-accent)]" role="alert">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--ts-ink-muted-on-paper)]">
          No brand accounts yet.
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-[var(--ts-hairline-on-paper)] border-y border-[var(--ts-hairline-on-paper)]">
          {rows.map((row) => {
            const pending = pendingId === row.id;
            return (
              <li
                key={row.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--ts-ink-on-paper)]">
                    {row.name}
                  </div>
                  <div className="truncate text-sm text-[var(--ts-ink-muted-on-paper)]">
                    {row.email}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(row)}
                  disabled={pendingId !== null}
                  className={row.isManaged ? inkBtn : ghostBtn}
                  style={radiusStyle}
                >
                  {pending ? "Saving…" : row.isManaged ? "Managed" : "Mark managed"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
