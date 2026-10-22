"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { crmRequest, jsonInit } from "./api";
import {
  crmCard,
  crmMuted,
  crmRadius,
  fieldClass,
  ghostButtonClass,
  labelClass,
  primaryButtonClass,
} from "./chrome";
import { formatDay, formatFlight, formatUsd, labelOf } from "./format";
import { CRM_NAME_MAX, CRM_NOTE_MAX, CRM_PHONE_MAX, CRM_ROLE_MAX, EMAIL_RE } from "./limits";
import { toContactView, toNoteView, type CrmContactView, type CrmDealView, type CrmNoteView } from "./types";

function StatusPill({ children }: { children: string }) {
  return (
    <span
      className="inline-flex items-center bg-[var(--ts-band-shows)] px-2 py-0.5 text-xs font-medium text-[var(--ts-ink-on-paper)]"
      style={crmRadius}
    >
      {children}
    </span>
  );
}

function fieldError(name: string, email: string, role: string, phone: string, editing: boolean): string | null {
  const trimmed = name.trim();
  if (!trimmed) return editing ? `Name must be between 1 and ${CRM_NAME_MAX} characters.` : "Name is required.";
  if (trimmed.length > CRM_NAME_MAX) {
    return editing
      ? `Name must be between 1 and ${CRM_NAME_MAX} characters.`
      : `Name must be ${CRM_NAME_MAX} characters or fewer.`;
  }
  const nextEmail = email.trim().toLowerCase();
  if (nextEmail && !EMAIL_RE.test(nextEmail)) return "Email is not valid.";
  if (role.trim().length > CRM_ROLE_MAX) return `Role must be ${CRM_ROLE_MAX} characters or fewer.`;
  if (phone.trim().length > CRM_PHONE_MAX) return `Phone must be ${CRM_PHONE_MAX} characters or fewer.`;
  return null;
}

export function ContactsPanel({
  showId,
  contacts,
  onChange,
}: {
  showId: string;
  contacts: CrmContactView[];
  onChange: (next: CrmContactView[]) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function addContact(event: FormEvent) {
    event.preventDefault();
    const problem = fieldError(name, email, role, phone, false);
    if (problem) {
      setError(problem);
      return;
    }
    const pending: CrmContactView = {
      id: `pending-${crypto.randomUUID()}`,
      name: name.trim(),
      email: email.trim().toLowerCase() || null,
      role: role.trim() || null,
      phone: phone.trim() || null,
    };
    const previous = contacts;
    const draft = { name, email, role, phone };
    onChange([pending, ...contacts]);
    setName("");
    setEmail("");
    setRole("");
    setPhone("");
    setError(null);
    setBusy(true);
    const result = await crmRequest(
      `/api/crm/shows/${showId}/contacts`,
      jsonInit("POST", {
        name: pending.name,
        email: pending.email,
        role: pending.role,
        phone: pending.phone,
      }),
    );
    setBusy(false);
    if (!result.ok) {
      onChange(previous);
      setName(draft.name);
      setEmail(draft.email);
      setRole(draft.role);
      setPhone(draft.phone);
      setError(result.error);
      return;
    }
    const saved = (result.data as { contact?: Parameters<typeof toContactView>[0] }).contact;
    if (!saved) {
      onChange(previous);
      setError("Could not save. Try again.");
      return;
    }
    onChange([toContactView(saved), ...previous]);
  }

  async function saveContact(next: CrmContactView) {
    const previous = contacts;
    onChange(contacts.map((item) => (item.id === next.id ? next : item)));
    setEditingId(null);
    setError(null);
    setBusy(true);
    const result = await crmRequest(
      `/api/crm/shows/${showId}/contacts/${next.id}`,
      jsonInit("PATCH", {
        name: next.name,
        email: next.email,
        role: next.role,
        phone: next.phone,
      }),
    );
    setBusy(false);
    if (!result.ok) {
      onChange(previous);
      setEditingId(next.id);
      setError(result.error);
      return;
    }
    const saved = (result.data as { contact?: Parameters<typeof toContactView>[0] }).contact;
    if (!saved) {
      onChange(previous);
      setError("Could not save. Try again.");
      return;
    }
    onChange(previous.map((item) => (item.id === next.id ? toContactView(saved) : item)));
  }

  async function removeContact(contact: CrmContactView) {
    const previous = contacts;
    onChange(contacts.filter((item) => item.id !== contact.id));
    setError(null);
    setBusy(true);
    const result = await crmRequest(
      `/api/crm/shows/${showId}/contacts/${contact.id}`,
      jsonInit("DELETE"),
    );
    setBusy(false);
    if (!result.ok) {
      onChange(previous);
      setError(result.error);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={addContact} className={`${crmCard} space-y-3`} style={crmRadius}>
        <h2 className="text-lg font-semibold">Add a contact</h2>
        <div>
          <label className={labelClass} htmlFor="contact-name">
            Name
          </label>
          <input
            id="contact-name"
            className={fieldClass}
            style={crmRadius}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="contact-email">
            Email
          </label>
          <input
            id="contact-email"
            type="email"
            className={fieldClass}
            style={crmRadius}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="contact-role">
              Role
            </label>
            <input
              id="contact-role"
              className={fieldClass}
              style={crmRadius}
              value={role}
              onChange={(event) => setRole(event.target.value)}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="contact-phone">
              Phone
            </label>
            <input
              id="contact-phone"
              className={fieldClass}
              style={crmRadius}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
        </div>
        {error ? <p className="text-sm text-[var(--ts-accent-text)]">{error}</p> : null}
        <button type="submit" className={primaryButtonClass} style={crmRadius} disabled={busy}>
          Add contact
        </button>
      </form>
      {contacts.length === 0 ? (
        <p className={crmMuted}>No contacts yet.</p>
      ) : (
        <ul className="space-y-3">
          {contacts.map((contact) => (
            <li key={contact.id} className={crmCard} style={crmRadius}>
              {editingId === contact.id ? (
                <ContactEditor
                  contact={contact}
                  busy={busy}
                  onCancel={() => setEditingId(null)}
                  onSave={saveContact}
                />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{contact.name}</p>
                    <p className={crmMuted}>
                      {[contact.role, contact.email, contact.phone].filter(Boolean).join(" · ") ||
                        "No details yet"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={ghostButtonClass}
                      style={crmRadius}
                      disabled={busy || contact.id.startsWith("pending-")}
                      onClick={() => setEditingId(contact.id)}
                    >
                      Edit {contact.name}
                    </button>
                    <button
                      type="button"
                      className={ghostButtonClass}
                      style={crmRadius}
                      disabled={busy || contact.id.startsWith("pending-")}
                      onClick={() => removeContact(contact)}
                    >
                      Remove {contact.name}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ContactEditor({
  contact,
  busy,
  onSave,
  onCancel,
}: {
  contact: CrmContactView;
  busy: boolean;
  onSave: (next: CrmContactView) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(contact.name);
  const [email, setEmail] = useState(contact.email ?? "");
  const [role, setRole] = useState(contact.role ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const problem = fieldError(name, email, role, phone, true);
        if (problem) {
          setError(problem);
          return;
        }
        onSave({
          ...contact,
          name: name.trim(),
          email: email.trim().toLowerCase() || null,
          role: role.trim() || null,
          phone: phone.trim() || null,
        });
      }}
    >
      <div>
        <label className={labelClass} htmlFor={`edit-name-${contact.id}`}>
          Name
        </label>
        <input
          id={`edit-name-${contact.id}`}
          className={fieldClass}
          style={crmRadius}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor={`edit-email-${contact.id}`}>
          Email
        </label>
        <input
          id={`edit-email-${contact.id}`}
          className={fieldClass}
          style={crmRadius}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor={`edit-role-${contact.id}`}>
            Role
          </label>
          <input
            id={`edit-role-${contact.id}`}
            className={fieldClass}
            style={crmRadius}
            value={role}
            onChange={(event) => setRole(event.target.value)}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={`edit-phone-${contact.id}`}>
            Phone
          </label>
          <input
            id={`edit-phone-${contact.id}`}
            className={fieldClass}
            style={crmRadius}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>
      </div>
      {error ? <p className="text-sm text-[var(--ts-accent-text)]">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" className={primaryButtonClass} style={crmRadius} disabled={busy}>
          Save {contact.name}
        </button>
        <button
          type="button"
          className={ghostButtonClass}
          style={crmRadius}
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function NotesPanel({
  showId,
  notes,
  onChange,
}: {
  showId: string;
  notes: CrmNoteView[];
  onChange: (next: CrmNoteView[]) => void;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(event: FormEvent) {
    event.preventDefault();
    const trimmed = body.trim();
    if (trimmed.length < 1 || trimmed.length > CRM_NOTE_MAX) {
      setError(`Note must be between 1 and ${CRM_NOTE_MAX} characters.`);
      return;
    }
    const pending: CrmNoteView = {
      id: `pending-${crypto.randomUUID()}`,
      body: trimmed,
      createdAt: new Date().toISOString(),
    };
    const previous = notes;
    const draft = body;
    onChange([pending, ...notes]);
    setBody("");
    setError(null);
    setBusy(true);
    const result = await crmRequest(
      `/api/crm/shows/${showId}/notes`,
      jsonInit("POST", { body: trimmed }),
    );
    setBusy(false);
    if (!result.ok) {
      onChange(previous);
      setBody(draft);
      setError(result.error);
      return;
    }
    const saved = (result.data as { note?: { id: string; body: string; created_at: string } }).note;
    if (!saved) {
      onChange(previous);
      setBody(draft);
      setError("Could not save. Try again.");
      return;
    }
    onChange([toNoteView(saved), ...previous]);
  }

  return (
    <div className="space-y-4">
      <form className={`${crmCard} space-y-3`} style={crmRadius} onSubmit={add}>
        <label className={labelClass} htmlFor="note-body">
          Note
        </label>
        <textarea
          id="note-body"
          className={fieldClass}
          style={crmRadius}
          rows={4}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        {error ? <p className="text-sm text-[var(--ts-accent-text)]">{error}</p> : null}
        <button type="submit" className={primaryButtonClass} style={crmRadius} disabled={busy}>
          Add note
        </button>
      </form>
      {notes.length === 0 ? (
        <p className={crmMuted}>No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id} className={crmCard} style={crmRadius}>
              <p>{note.body}</p>
              <p className={`mt-2 ${crmMuted}`}>{formatDay(note.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DealsPanel({ deals }: { deals: CrmDealView[] }) {
  if (deals.length === 0) {
    return <p className={crmMuted}>No deals with this show yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">Deal history</caption>
        <thead>
          <tr className="border-b border-[var(--ts-hairline-on-paper)] text-[var(--ts-ink-muted-on-paper)]">
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 pr-3 font-medium">Placement</th>
            <th className="py-2 pr-3 font-medium">Episodes</th>
            <th className="py-2 pr-3 font-medium">CPM</th>
            <th className="py-2 pr-3 font-medium">Total</th>
            <th className="py-2 font-medium">Flight</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr key={deal.id} className="border-b border-[var(--ts-hairline-on-paper)]">
              <td className="py-3 pr-3">
                <StatusPill>{labelOf(deal.status)}</StatusPill>
              </td>
              <td className="py-3 pr-3">{deal.placement ? labelOf(deal.placement) : "Unset"}</td>
              <td className="py-3 pr-3">{deal.numEpisodes ?? "Unset"}</td>
              <td className="py-3 pr-3">{deal.cpmRate == null ? "Unset" : formatUsd(deal.cpmRate)}</td>
              <td className="py-3 pr-3">
                {deal.totalGross == null ? "Unset" : formatUsd(deal.totalGross)}
              </td>
              <td className="py-3">{formatFlight(deal.flightStart, deal.flightEnd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
