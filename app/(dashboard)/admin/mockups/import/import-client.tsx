"use client";

import { useState } from "react";
import {
  POOLING_TERMS_VERSION,
  formatFlight,
  labelOf,
  sampleImportRows,
  type MockImportRecord,
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

type ImportStep = "choose" | "upload" | "review" | "consent" | "confirmed" | "discarded";
type SourceKind = "csv" | "xlsx" | "pdf";

const ACCEPT: Record<SourceKind, string> = {
  csv: ".csv,text/csv",
  xlsx: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: ".pdf,application/pdf",
};

const STEP_COPY: Record<ImportStep, string> = {
  choose: "Step 1 of 5. Choose a file type.",
  upload: "Step 2 of 5. Add the file.",
  review: "Step 3 of 5. Edit the rows.",
  consent: "Step 4 of 5. Consent.",
  confirmed: "Step 5 of 5. Confirmed.",
  discarded: "Import discarded.",
};

export function ImportClient({ initialStep = "choose" }: { initialStep?: ImportStep }) {
  const [step, setStep] = useState<ImportStep>(initialStep);
  const [sourceKind, setSourceKind] = useState<SourceKind | null>(
    initialStep === "choose" ? null : "csv",
  );
  const [fileName, setFileName] = useState<string | null>(
    initialStep === "choose" || initialStep === "upload" ? null : "sauna-box-q1.csv",
  );
  const [rows, setRows] = useState<MockImportRecord[]>(() =>
    initialStep === "review" || initialStep === "consent" || initialStep === "confirmed"
      ? sampleImportRows()
      : [],
  );
  const [consent, setConsent] = useState(false);

  function choose(kind: SourceKind) {
    setSourceKind(kind);
    setFileName(null);
    setRows([]);
    setConsent(false);
    setStep("upload");
  }

  function useSample() {
    if (!sourceKind) return;
    setFileName(`sauna-box-q1.${sourceKind}`);
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
  }

  function openReview() {
    if (!fileName) return;
    setRows(sampleImportRows());
    setStep("review");
  }

  function updateRow(id: string, patch: Partial<MockImportRecord>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function reset() {
    setStep("choose");
    setSourceKind(null);
    setFileName(null);
    setRows([]);
    setConsent(false);
  }

  return (
    <MockupPage
      kicker="Import"
      title="Past campaign import"
      lede="Sauna Box brings in an old campaign file. The catalog suggestion is advisory. The brand keeps the row either way."
      wide
    >
      <p className={mockupMuted} data-testid="import-step">
        {STEP_COPY[step]}
      </p>

      {step === "choose" ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {(["csv", "xlsx", "pdf"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={`${mockupCard} text-left hover:bg-[var(--ts-band-shows)]`}
              style={mockupRadius}
              onClick={() => choose(kind)}
            >
              <p className="font-medium">{labelOf(kind)}</p>
              <p className={mockupMuted}>Upload a {labelOf(kind)} file of past flights.</p>
            </button>
          ))}
        </div>
      ) : null}

      {step === "upload" && sourceKind ? (
        <div className={`${mockupCard} mt-4 space-y-4`} style={mockupRadius}>
          <p className="font-medium">{labelOf(sourceKind)} file</p>
          <p className={mockupMuted}>
            Review uses sample rows so you can edit the match hints. The file itself is not stored.
          </p>
          <div>
            <label className={labelClass} htmlFor="import-file">
              Choose a {labelOf(sourceKind)} file
            </label>
            <input
              id="import-file"
              type="file"
              accept={ACCEPT[sourceKind]}
              className="block text-sm text-[var(--ts-ink-on-paper)]"
              onChange={(event) => onFile(event.target.files?.[0])}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={ghostButtonClass} style={mockupRadius} onClick={useSample}>
              Use sample file
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              style={mockupRadius}
              disabled={!fileName}
              onClick={openReview}
            >
              Review rows
            </button>
            <button type="button" className={ghostButtonClass} style={mockupRadius} onClick={reset}>
              Back
            </button>
          </div>
          {fileName ? <p className={mockupMuted}>Selected file: {fileName}</p> : null}
        </div>
      ) : null}

      {step === "review" ? (
        <div className="mt-4 space-y-4">
          <p className={mockupMuted}>
            {fileName} · {sourceKind ? labelOf(sourceKind) : "File"} · {rows.length} rows
          </p>
          {rows.map((row) => (
            <ImportRowEditor key={row.id} row={row} onChange={(patch) => updateRow(row.id, patch)} />
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={primaryButtonClass}
              style={mockupRadius}
              onClick={() => setStep("consent")}
            >
              Continue to consent
            </button>
            <button
              type="button"
              className={ghostButtonClass}
              style={mockupRadius}
              onClick={() => setStep("discarded")}
            >
              Discard import
            </button>
            <button
              type="button"
              className={ghostButtonClass}
              style={mockupRadius}
              onClick={() => setStep("upload")}
            >
              Back
            </button>
          </div>
        </div>
      ) : null}

      {step === "consent" ? (
        <form
          className={`${mockupCard} mt-4 space-y-4`}
          style={mockupRadius}
          onSubmit={(event) => {
            event.preventDefault();
            setStep("confirmed");
          }}
        >
          <p>
            I agree this import may later be anonymized into a shared pool. Terms version{" "}
            {POOLING_TERMS_VERSION}. Leaving this unchecked keeps the file private to the brand.
          </p>
          <label className="flex items-start gap-2 text-sm" htmlFor="pooling-consent">
            <input
              id="pooling-consent"
              type="checkbox"
              className="mt-1"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>Allow a later anonymized pool for this file.</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primaryButtonClass} style={mockupRadius}>
              Confirm import
            </button>
            <button
              type="button"
              className={ghostButtonClass}
              style={mockupRadius}
              onClick={() => setStep("review")}
            >
              Back
            </button>
          </div>
        </form>
      ) : null}

      {step === "confirmed" ? (
        <ConfirmedSummary
          fileName={fileName}
          sourceKind={sourceKind}
          consent={consent}
          rows={rows}
          onReset={reset}
        />
      ) : null}

      {step === "discarded" ? (
        <div className={`${mockupCard} mt-4 space-y-3`} style={mockupRadius}>
          <StatusPill>Discarded</StatusPill>
          <p>Nothing from {fileName ?? "this file"} is kept in the preview.</p>
          <button type="button" className={primaryButtonClass} style={mockupRadius} onClick={reset}>
            Start over
          </button>
        </div>
      ) : null}
    </MockupPage>
  );
}

function ImportRowEditor({
  row,
  onChange,
}: {
  row: MockImportRecord;
  onChange: (patch: Partial<MockImportRecord>) => void;
}) {
  return (
    <fieldset className={`${mockupCard} space-y-3`} style={mockupRadius}>
      <legend className="px-1 text-sm font-medium">Imported row</legend>
      <div>
        <label className={labelClass} htmlFor={`show-${row.id}`}>
          Show name
        </label>
        <input
          id={`show-${row.id}`}
          className={fieldClass}
          style={mockupRadius}
          value={row.showName}
          onChange={(event) => onChange({ showName: event.target.value })}
        />
      </div>
      <p className={mockupMuted} data-testid={`match-${row.id}`}>
        {row.matchedShowName
          ? `Catalog suggestion: ${row.matchedShowName}. The imported name stays unless you change it.`
          : "No catalog suggestion."}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor={`start-${row.id}`}>
            Flight start
          </label>
          <input
            id={`start-${row.id}`}
            type="date"
            className={fieldClass}
            style={mockupRadius}
            value={row.flightStart}
            onChange={(event) => onChange({ flightStart: event.target.value })}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={`end-${row.id}`}>
            Flight end
          </label>
          <input
            id={`end-${row.id}`}
            type="date"
            className={fieldClass}
            style={mockupRadius}
            value={row.flightEnd}
            onChange={(event) => onChange({ flightEnd: event.target.value })}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor={`placement-${row.id}`}>
            Placement
          </label>
          <select
            id={`placement-${row.id}`}
            className={fieldClass}
            style={mockupRadius}
            value={row.placement}
            onChange={(event) => onChange({ placement: event.target.value })}
          >
            <option value="pre-roll">Pre-roll</option>
            <option value="mid-roll">Mid-roll</option>
            <option value="post-roll">Post-roll</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`price-${row.id}`}>
            Price type
          </label>
          <select
            id={`price-${row.id}`}
            className={fieldClass}
            style={mockupRadius}
            value={row.priceType}
            onChange={(event) =>
              onChange({ priceType: event.target.value as MockImportRecord["priceType"] })
            }
          >
            <option value="">Unset</option>
            <option value="cpm">CPM</option>
            <option value="flat">Flat rate</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`episodes-${row.id}`}>
            Episodes
          </label>
          <input
            id={`episodes-${row.id}`}
            className={fieldClass}
            style={mockupRadius}
            inputMode="numeric"
            value={row.episodes}
            onChange={(event) => onChange({ episodes: event.target.value })}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor={`rate-${row.id}`}>
            Rate
          </label>
          <input
            id={`rate-${row.id}`}
            className={fieldClass}
            style={mockupRadius}
            inputMode="decimal"
            value={row.rate}
            onChange={(event) => onChange({ rate: event.target.value })}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={`spend-${row.id}`}>
            Spend
          </label>
          <input
            id={`spend-${row.id}`}
            className={fieldClass}
            style={mockupRadius}
            inputMode="decimal"
            value={row.spend}
            onChange={(event) => onChange({ spend: event.target.value })}
          />
        </div>
      </div>
    </fieldset>
  );
}

function ConfirmedSummary({
  fileName,
  sourceKind,
  consent,
  rows,
  onReset,
}: {
  fileName: string | null;
  sourceKind: SourceKind | null;
  consent: boolean;
  rows: MockImportRecord[];
  onReset: () => void;
}) {
  return (
    <div className="mt-4 space-y-4" data-testid="import-confirmed">
      <div className={mockupCard} style={mockupRadius}>
        <StatusPill>Confirmed</StatusPill>
        <p className="mt-3 font-medium">{fileName}</p>
        <p className={mockupMuted}>{sourceKind ? labelOf(sourceKind) : "File"}</p>
        <p className="mt-3">
          {consent
            ? `Pooling consent: yes. Terms version ${POOLING_TERMS_VERSION}.`
            : "Pooling consent: no. This file stays private to the brand."}
        </p>
      </div>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className={mockupCard} style={mockupRadius}>
            <p className="font-medium">{row.showName}</p>
            <p className={mockupMuted}>
              {formatFlight(row.flightStart, row.flightEnd)}
              {row.placement ? ` · ${labelOf(row.placement)}` : ""}
              {row.priceType ? ` · ${labelOf(row.priceType)}` : ""}
            </p>
            {row.matchedShowName ? (
              <p className={`mt-1 ${mockupMuted}`}>Catalog suggestion: {row.matchedShowName}.</p>
            ) : (
              <p className={`mt-1 ${mockupMuted}`}>No catalog suggestion.</p>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className={primaryButtonClass} style={mockupRadius} onClick={onReset}>
        Start over
      </button>
    </div>
  );
}
