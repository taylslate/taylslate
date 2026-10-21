"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CRM_CONTACTS,
  CRM_DEALS,
  CRM_NAME_MAX,
  CRM_NOTES,
  CRM_NOTE_MAX,
  formatDay,
  formatFlight,
  formatUsd,
  getCrmShow,
  labelOf,
  type MockContact,
  type MockDealHistory,
  type MockNote,
} from "../../fixtures";
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
} from "../../chrome";

type Tab = "contacts" | "notes" | "deals";

const TABS: { id: Tab; label: string }[] = [
  { id: "contacts", label: "Contacts" },
  { id: "notes", label: "Notes" },
  { id: "deals", label: "Deal history" },
];

export function CrmShowClient({
  showId,
  initialTab = "contacts",
}: {
  showId: string;
  initialTab?: Tab;
}) {
  const show = getCrmShow(showId);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [contacts, setContacts] = useState<MockContact[]>(() =>
    CRM_CONTACTS.filter((contact) => contact.showId === showId),
  );
  const [notes, setNotes] = useState<MockNote[]>(() =>
    CRM_NOTES.filter((note) => note.showId === showId),
  );
  const deals = CRM_DEALS.filter((deal) => deal.showId === showId);

  if (!show) {
    return (
      <MockupPage kicker="CRM" title="Show">
        <p className={mockupMuted}>This show is not in the preview.</p>
      </MockupPage>
    );
  }

  return (
    <MockupPage
      kicker="CRM"
      title={show.name}
      lede={`${show.medium}. Contacts and notes are for Sauna Box only. Deal history is read-only.`}
    >
      <Link
        href="/admin/mockups/crm"
        className="mb-6 inline-block text-sm text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
      >
        Brand CRM
      </Link>
      <div role="tablist" aria-label={`${show.name} CRM`} className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            className={tab === item.id ? primaryButtonClass : ghostButtonClass}
            style={mockupRadius}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-6" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "contacts" ? (
          <ContactsPanel showId={showId} contacts={contacts} onChange={setContacts} />
        ) : null}
        {tab === "notes" ? <NotesPanel showId={showId} notes={notes} onChange={setNotes} /> : null}
        {tab === "deals" ? <DealsPanel deals={deals} /> : null}
      </div>
    </MockupPage>
  );
}

function ContactsPanel({
  showId,
  contacts,
  onChange,
}: {
  showId: string;
  contacts: MockContact[];
  onChange: (next: MockContact[]) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  function addContact(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    if (trimmed.length > CRM_NAME_MAX) {
      setError(`Name must be ${CRM_NAME_MAX} characters or fewer.`);
      return;
    }
    const nextEmail = email.trim().toLowerCase();
    if (nextEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      setError("Email is not valid.");
      return;
    }
    onChange([
      {
        id: `contact-local-${contacts.length + 1}`,
        showId,
        name: trimmed,
        email: nextEmail || null,
        role: role.trim() || null,
        phone: phone.trim() || null,
        createdAt: new Date().toISOString(),
      },
      ...contacts,
    ]);
    setName("");
    setEmail("");
    setRole("");
    setPhone("");
    setError(null);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={addContact} className={`${mockupCard} space-y-3`} style={mockupRadius}>
        <h2 className="text-lg font-semibold">Add a contact</h2>
        <div>
          <label className={labelClass} htmlFor="contact-name">
            Name
          </label>
          <input
            id="contact-name"
            className={fieldClass}
            style={mockupRadius}
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
            style={mockupRadius}
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
              style={mockupRadius}
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
              style={mockupRadius}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
        </div>
        {error ? <p className="text-sm text-[var(--ts-accent-text)]">{error}</p> : null}
        <button type="submit" className={primaryButtonClass} style={mockupRadius}>
          Add contact
        </button>
      </form>
      {contacts.length === 0 ? (
        <p className={mockupMuted}>No contacts yet.</p>
      ) : (
        <ul className="space-y-3">
          {contacts.map((contact) => (
            <li key={contact.id} className={mockupCard} style={mockupRadius}>
              {editingId === contact.id ? (
                <ContactEditor
                  contact={contact}
                  onCancel={() => setEditingId(null)}
                  onSave={(next) => {
                    onChange(contacts.map((item) => (item.id === next.id ? next : item)));
                    setEditingId(null);
                  }}
                />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{contact.name}</p>
                    <p className={mockupMuted}>
                      {[contact.role, contact.email, contact.phone].filter(Boolean).join(" · ") ||
                        "No details yet"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={ghostButtonClass}
                      style={mockupRadius}
                      onClick={() => setEditingId(contact.id)}
                    >
                      Edit {contact.name}
                    </button>
                    <button
                      type="button"
                      className={ghostButtonClass}
                      style={mockupRadius}
                      onClick={() => onChange(contacts.filter((item) => item.id !== contact.id))}
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
  onSave,
  onCancel,
}: {
  contact: MockContact;
  onSave: (next: MockContact) => void;
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
        const trimmed = name.trim();
        if (!trimmed || trimmed.length > CRM_NAME_MAX) {
          setError(`Name must be between 1 and ${CRM_NAME_MAX} characters.`);
          return;
        }
        onSave({
          ...contact,
          name: trimmed,
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
          style={mockupRadius}
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
          style={mockupRadius}
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
            style={mockupRadius}
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
            style={mockupRadius}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>
      </div>
      {error ? <p className="text-sm text-[var(--ts-accent-text)]">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" className={primaryButtonClass} style={mockupRadius}>
          Save {contact.name}
        </button>
        <button type="button" className={ghostButtonClass} style={mockupRadius} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function NotesPanel({
  showId,
  notes,
  onChange,
}: {
  showId: string;
  notes: MockNote[];
  onChange: (next: MockNote[]) => void;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <form
        className={`${mockupCard} space-y-3`}
        style={mockupRadius}
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = body.trim();
          if (trimmed.length < 1 || trimmed.length > CRM_NOTE_MAX) {
            setError(`Note must be between 1 and ${CRM_NOTE_MAX} characters.`);
            return;
          }
          onChange([
            {
              id: `note-local-${notes.length + 1}`,
              showId,
              body: trimmed,
              createdAt: new Date().toISOString(),
            },
            ...notes,
          ]);
          setBody("");
          setError(null);
        }}
      >
        <label className={labelClass} htmlFor="note-body">
          Note
        </label>
        <textarea
          id="note-body"
          className={fieldClass}
          style={mockupRadius}
          rows={4}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        {error ? <p className="text-sm text-[var(--ts-accent-text)]">{error}</p> : null}
        <button type="submit" className={primaryButtonClass} style={mockupRadius}>
          Add note
        </button>
      </form>
      {notes.length === 0 ? (
        <p className={mockupMuted}>No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id} className={mockupCard} style={mockupRadius}>
              <p>{note.body}</p>
              <p className={`mt-2 ${mockupMuted}`}>{formatDay(note.createdAt)}</p>
              <button
                type="button"
                className={`${ghostButtonClass} mt-3`}
                style={mockupRadius}
                onClick={() => onChange(notes.filter((item) => item.id !== note.id))}
              >
                Remove note
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DealsPanel({ deals }: { deals: MockDealHistory[] }) {
  if (deals.length === 0) {
    return <p className={mockupMuted}>No deals with this show yet.</p>;
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
              <td className="py-3 pr-3">
                {deal.cpmRate == null ? "Unset" : formatUsd(deal.cpmRate)}
              </td>
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
