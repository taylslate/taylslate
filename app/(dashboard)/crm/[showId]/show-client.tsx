"use client";

import { useState } from "react";
import Link from "next/link";
import { ghostButtonClass, primaryButtonClass, crmRadius } from "../components/chrome";
import { CrmShell, crmShowLede } from "../components/shell";
import { ContactsPanel, DealsPanel, NotesPanel } from "../components/show-panels";
import type { CrmContactView, CrmDealView, CrmNoteView, CrmShowView } from "../components/types";

type Tab = "contacts" | "notes" | "deals";

const TABS: { id: Tab; label: string }[] = [
  { id: "contacts", label: "Contacts" },
  { id: "notes", label: "Notes" },
  { id: "deals", label: "Deal history" },
];

export function CrmShowClient({
  show,
  brandName,
  contacts: initialContacts,
  notes: initialNotes,
  deals,
  initialTab = "contacts",
}: {
  show: CrmShowView;
  brandName: string;
  contacts: CrmContactView[];
  notes: CrmNoteView[];
  deals: CrmDealView[];
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [contacts, setContacts] = useState(initialContacts);
  const [notes, setNotes] = useState(initialNotes);

  return (
    <CrmShell kicker="CRM" title={show.name || "Show"} lede={crmShowLede(brandName)}>
      <Link
        href="/crm"
        className="mb-6 inline-block text-sm text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
      >
        Brand CRM
      </Link>
      <div role="tablist" aria-label={`${show.name || "Show"} CRM`} className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            className={tab === item.id ? primaryButtonClass : ghostButtonClass}
            style={crmRadius}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-6" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "contacts" ? (
          <ContactsPanel showId={show.id} contacts={contacts} onChange={setContacts} />
        ) : null}
        {tab === "notes" ? <NotesPanel showId={show.id} notes={notes} onChange={setNotes} /> : null}
        {tab === "deals" ? <DealsPanel deals={deals} /> : null}
      </div>
    </CrmShell>
  );
}
