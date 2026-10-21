"use client";

import { useState } from "react";
import {
  REP_NAV,
  SAMPLE_ROSTER_CSV,
  parseRosterCsv,
} from "../../fixtures";
import {
  ExclusiveToggle,
  MockupLinks,
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

interface PreviewRow {
  id: string;
  showName: string;
  isExclusive: boolean;
}

function toPreview(names: { showName: string }[]): PreviewRow[] {
  return names.map((row, index) => ({
    id: `csv-row-${index + 1}`,
    showName: row.showName,
    isExclusive: true,
  }));
}

export function RosterUploadClient() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  function loadText(name: string, text: string) {
    const parsed = parseRosterCsv(text);
    setFileName(name);
    setConfirmed(false);
    if (parsed.length === 0) {
      setRows([]);
      setError("No show names found in that file.");
      return;
    }
    setRows(toPreview(parsed));
    setError(null);
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      loadText(file.name, text);
    };
    reader.onerror = () => {
      setError("That file could not be read in this preview.");
    };
    reader.readAsText(file);
  }

  return (
    <MockupPage
      kicker="Rep"
      title="Roster CSV"
      lede="Imported shows start pending, and exclusive starts on. Confirming stays in this preview."
      wide
    >
      <MockupLinks links={REP_NAV} label="Rep screens" />
      <div className={`${mockupCard} space-y-3`} style={mockupRadius}>
        <label className={labelClass} htmlFor="roster-csv">
          CSV file
        </label>
        <input
          id="roster-csv"
          type="file"
          accept=".csv,text/csv"
          className="block text-sm"
          onChange={(event) => onFile(event.target.files?.[0])}
        />
        <button
          type="button"
          className={ghostButtonClass}
          style={mockupRadius}
          onClick={() => loadText("northwind-roster.csv", SAMPLE_ROSTER_CSV)}
        >
          Use sample roster
        </button>
        {fileName ? <p className={mockupMuted}>Selected file: {fileName}</p> : null}
        {error ? <p className="text-sm text-[var(--ts-accent-text)]">{error}</p> : null}
      </div>

      {rows.length > 0 && !confirmed ? (
        <div className="mt-6 space-y-3" data-testid="roster-csv-preview">
          <h2 className="text-lg font-semibold">Preview</h2>
          <ul className="space-y-3">
            {rows.map((row) => (
              <li
                key={row.id}
                className={`${mockupCard} flex flex-wrap items-center justify-between gap-3`}
                style={mockupRadius}
              >
                <div>
                  <label className={labelClass} htmlFor={`csv-name-${row.id}`}>
                    Show name
                  </label>
                  <input
                    id={`csv-name-${row.id}`}
                    className={fieldClass}
                    style={mockupRadius}
                    value={row.showName}
                    onChange={(event) =>
                      setRows((current) =>
                        current.map((item) =>
                          item.id === row.id ? { ...item, showName: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <p className={`mt-2 ${mockupMuted}`}>
                    <StatusPill>Pending</StatusPill>
                  </p>
                </div>
                <ExclusiveToggle
                  on={row.isExclusive}
                  showName={row.showName}
                  onToggle={() =>
                    setRows((current) =>
                      current.map((item) =>
                        item.id === row.id ? { ...item, isExclusive: !item.isExclusive } : item,
                      ),
                    )
                  }
                />
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={primaryButtonClass}
            style={mockupRadius}
            onClick={() => setConfirmed(true)}
          >
            Confirm preview
          </button>
        </div>
      ) : null}

      {confirmed ? (
        <div className={`${mockupCard} mt-6 space-y-3`} style={mockupRadius} data-testid="roster-csv-confirmed">
          <StatusPill>Pending</StatusPill>
          <p className="font-medium">{rows.length} shows added to the preview roster.</p>
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.id} className={mockupMuted}>
                {row.showName}. {row.isExclusive ? "Exclusive" : "Not exclusive"}. Pending.
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={ghostButtonClass}
            style={mockupRadius}
            onClick={() => {
              setConfirmed(false);
              setRows([]);
              setFileName(null);
            }}
          >
            Upload another file
          </button>
        </div>
      ) : null}
    </MockupPage>
  );
}
