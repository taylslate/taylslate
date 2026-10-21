"use client";

import { useState } from "react";
import { tokens } from "@/lib/brand/tokens";
import type { ManagedBrandRow } from "@/lib/accounts/managed";
import {
  isValidLoginEmail,
  normalizeLoginEmail,
} from "@/lib/auth/login-magic";

const radiusStyle = { borderRadius: tokens.radius };
const inkBtn =
  "inline-flex items-center bg-[var(--ts-accent)] px-3 py-1.5 text-sm font-medium text-[var(--ts-accent-foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtn =
  "inline-flex items-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-1.5 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)] disabled:cursor-not-allowed disabled:opacity-50";
const fieldClass =
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-1.5 text-sm text-[var(--ts-ink-on-paper)]";

export default function ManagedBrandsClient({
  brands,
}: {
  brands: ManagedBrandRow[];
}) {
  const [rows, setRows] = useState(brands);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [handoffId, setHandoffId] = useState<string | null>(null);
  const [handoffEmail, setHandoffEmail] = useState("");
  const [handoffStep, setHandoffStep] = useState<"email" | "confirm">("email");

  function closeHandoff() {
    setHandoffId(null);
    setHandoffEmail("");
    setHandoffStep("email");
  }

  function openHandoff(row: ManagedBrandRow) {
    setError(null);
    setNotice(null);
    setHandoffId(row.id);
    setHandoffEmail("");
    setHandoffStep("email");
  }

  async function toggle(row: ManagedBrandRow) {
    setPendingId(row.id);
    setError(null);
    setNotice(null);
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
      if (body.isManaged === false && handoffId === row.id) closeHandoff();
    } catch {
      setError("Couldn't update that brand");
    } finally {
      setPendingId(null);
    }
  }

  function reviewHandoff() {
    const email = normalizeLoginEmail(handoffEmail);
    if (!isValidLoginEmail(email)) {
      setError("Enter the owner's email");
      return;
    }
    setError(null);
    setHandoffEmail(email);
    setHandoffStep("confirm");
  }

  async function confirmHandoff(row: ManagedBrandRow) {
    const email = normalizeLoginEmail(handoffEmail);
    setPendingId(row.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/managed-brands/${row.id}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        email?: string;
        isManaged?: boolean;
        emailSent?: boolean;
        error?: string;
      };
      if (!res.ok || body.isManaged !== false || typeof body.email !== "string") {
        setError(body.error ?? "Couldn't hand off that brand");
        return;
      }
      setRows((current) =>
        current.map((item) =>
          item.id === row.id
            ? { ...item, email: body.email as string, isManaged: false }
            : item,
        ),
      );
      closeHandoff();
      if (body.emailSent === false) {
        setError(
          "Handed off, but the sign-in email did not send. They can request a link from Log in.",
        );
      } else {
        setNotice(`Sign-in link sent to ${body.email}.`);
      }
    } catch {
      setError("Couldn't hand off that brand");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="w-full p-4 sm:p-8">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--ts-accent-text)]">
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
        <p className="mt-4 text-sm text-[var(--ts-accent-text)]" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-4 text-sm text-[var(--ts-ink-muted-on-paper)]">{notice}</p>
      )}

      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--ts-ink-muted-on-paper)]">
          No brand accounts yet.
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-[var(--ts-hairline-on-paper)] border-y border-[var(--ts-hairline-on-paper)]">
          {rows.map((row) => {
            const pending = pendingId === row.id;
            const handingOff = handoffId === row.id;
            return (
              <li key={row.id} className="py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--ts-ink-on-paper)]">
                      {row.name}
                    </div>
                    <div className="truncate text-sm text-[var(--ts-ink-muted-on-paper)]">
                      {row.email}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {row.isManaged && (
                      <button
                        type="button"
                        onClick={() => openHandoff(row)}
                        disabled={pendingId !== null}
                        className={ghostBtn}
                        style={radiusStyle}
                      >
                        Hand off
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => toggle(row)}
                      disabled={pendingId !== null}
                      aria-pressed={row.isManaged}
                      className={row.isManaged ? inkBtn : ghostBtn}
                      style={radiusStyle}
                    >
                      {pending ? "Saving…" : row.isManaged ? "Managed" : "Not managed"}
                    </button>
                  </div>
                </div>

                {handingOff && row.isManaged && handoffStep === "email" && (
                  <form
                    className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"
                    onSubmit={(event) => {
                      event.preventDefault();
                      reviewHandoff();
                    }}
                  >
                    <label className="sr-only" htmlFor={`handoff-email-${row.id}`}>
                      New owner email
                    </label>
                    <input
                      id={`handoff-email-${row.id}`}
                      type="email"
                      value={handoffEmail}
                      onChange={(event) => setHandoffEmail(event.target.value)}
                      placeholder="New owner email"
                      autoComplete="email"
                      className={fieldClass}
                      style={radiusStyle}
                    />
                    <button
                      type="submit"
                      disabled={pendingId !== null}
                      className={inkBtn}
                      style={radiusStyle}
                    >
                      Continue
                    </button>
                    <button
                      type="button"
                      onClick={closeHandoff}
                      disabled={pendingId !== null}
                      className={ghostBtn}
                      style={radiusStyle}
                    >
                      Cancel
                    </button>
                  </form>
                )}

                {handingOff && row.isManaged && handoffStep === "confirm" && (
                  <div className="mt-3">
                    <p className="text-sm text-[var(--ts-ink-on-paper)]">
                      Hand {row.name} from {row.email} to {handoffEmail}?
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => confirmHandoff(row)}
                        disabled={pendingId !== null}
                        className={inkBtn}
                        style={radiusStyle}
                      >
                        {pending ? "Handing off…" : "Confirm handoff"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setHandoffStep("email")}
                        disabled={pendingId !== null}
                        className={ghostBtn}
                        style={radiusStyle}
                      >
                        Back
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
