"use client";

import { useRef, useState } from "react";
import {
  crmCard,
  crmKicker,
  crmMuted,
  crmRadius,
  fieldClass,
  ghostButtonClass,
  labelClass,
  primaryButtonClass,
} from "@/app/(dashboard)/crm/components/chrome";
import {
  catalogSuggestionLabel,
  draftsToRows,
  importLede,
  messageFromApi,
  placementChoices,
  placementLabel,
  POOLING_TERMS_VERSION,
  priceTypeLabel,
  readParsePayload,
  recordCountLabel,
  ReviewInputError,
  rowEditErrors,
  rowsToSaveBody,
  sourceKindLabel,
  type CatalogHint,
  type ReviewFieldError,
  type ReviewRow,
  type ReviewSourceKind,
} from "@/lib/imports/review";

type Step = "upload" | "review" | "consent" | "confirmed" | "discarded";

const STEP_COPY: Record<Step, string> = {
  upload: "Step 1 of 4. Add the file.",
  review: "Step 2 of 4. Edit the rows.",
  consent: "Step 3 of 4. Consent.",
  confirmed: "Step 4 of 4. Confirmed.",
  discarded: "Import discarded.",
};

const ACCEPT =
  ".csv,.xlsx,.pdf,text/csv,application/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf";

export function ImportReviewClient({
  brandId,
  brandName,
  lookupCatalog,
}: {
  brandId: string;
  brandName: string;
  lookupCatalog: (names: string[]) => Promise<CatalogHint[]>;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<ReviewSourceKind | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [hints, setHints] = useState<CatalogHint[]>([]);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ReviewFieldError[]>([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [fileKey, setFileKey] = useState(0);
  const savingRef = useRef(false);

  const activeRows = rows.filter((row) => !row.removed);

  function reset() {
    setStep("upload");
    setFile(null);
    setFileName(null);
    setSourceKind(null);
    setRows([]);
    setHints([]);
    setConsent(false);
    setError(null);
    setFieldErrors([]);
    setReading(false);
    setSaving(false);
    setSavedCount(0);
    setFileKey((key) => key + 1);
    savingRef.current = false;
  }

  async function openReview() {
    if (!file || reading) return;
    setReading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("mode", "past_campaign");
      const response = await fetch("/api/deals/import?mode=past_campaign", {
        method: "POST",
        body,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(messageFromApi(payload, "Could not read this file."));
        return;
      }
      const parsed = readParsePayload(payload);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      const nextRows = draftsToRows(parsed.drafts);
      let nextHints: CatalogHint[] = [];
      try {
        nextHints = await lookupCatalog(nextRows.map((row) => row.showName));
      } catch {
        nextHints = [];
      }
      setRows(nextRows);
      setHints(Array.isArray(nextHints) ? nextHints : []);
      setFileName(parsed.fileName ?? file.name);
      setSourceKind(parsed.sourceKind);
      setFieldErrors([]);
      setConsent(false);
      setStep("review");
    } catch {
      setError("Could not read this file.");
    } finally {
      setReading(false);
    }
  }

  function updateRow(id: string, patch: Partial<ReviewRow>) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
    setFieldErrors((current) => current.filter((item) => item.id !== id));
  }

  async function refreshHints(nextRows: ReviewRow[]) {
    try {
      const nextHints = await lookupCatalog(
        nextRows.filter((row) => !row.removed).map((row) => row.showName)
      );
      setHints(Array.isArray(nextHints) ? nextHints : []);
    } catch {
      setHints([]);
    }
  }

  function continueToConsent() {
    const errors = rowEditErrors(activeRows);
    if (errors.length > 0) {
      setFieldErrors(errors);
      setError(errors[0].message);
      return;
    }
    setFieldErrors([]);
    setError(null);
    setStep("consent");
  }

  async function confirmImport() {
    if (savingRef.current || !sourceKind) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const payload = rowsToSaveBody({
        brandId,
        sourceKind,
        fileName,
        rows,
        poolingConsent: consent,
      });
      const response = await fetch("/api/imports/past-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(messageFromApi(body, "Could not save this import."));
        savingRef.current = false;
        return;
      }
      const records = body && typeof body === "object" ? (body as { records?: unknown }).records : null;
      if (!Array.isArray(records)) {
        setError("Could not save this import.");
        savingRef.current = false;
        return;
      }
      setSavedCount(records.length);
      setStep("confirmed");
    } catch (err) {
      if (err instanceof ReviewInputError) {
        setFieldErrors(err.errors);
        setError(err.message);
        setStep("review");
      } else {
        setError("Could not save this import.");
      }
      savingRef.current = false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-8 text-[var(--ts-ink-on-paper)] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <p className={crmKicker}>Import</p>
        <h1 className="mt-2 font-[family-name:var(--font-app-display)] text-2xl font-semibold tracking-tight">
          Past campaign import
        </h1>
        <p className={`mt-2 ${crmMuted}`}>{importLede(brandName)}</p>

        <p className={`mt-8 ${crmMuted}`} data-testid="import-step">
          {STEP_COPY[step]}
        </p>
        {error ? (
          <p
            role="alert"
            data-testid="import-error"
            className={`${crmCard} mt-4 text-sm text-[var(--ts-accent-text)]`}
            style={crmRadius}
          >
            {error}
          </p>
        ) : null}

        {step === "upload" ? (
          <div className={`${crmCard} mt-4 space-y-4`} style={crmRadius}>
            <p className="font-medium">CSV, XLSX, or PDF file</p>
            <p className={crmMuted}>
              The file itself is not stored. Review uses the parsed rows. Nothing is saved until you confirm.
            </p>
            <div>
              <label className={labelClass} htmlFor="import-file">
                Choose a CSV, XLSX, or PDF file
              </label>
              <input
                key={fileKey}
                id="import-file"
                type="file"
                accept={ACCEPT}
                className="block text-sm text-[var(--ts-ink-on-paper)]"
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  setFile(next);
                  setError(null);
                }}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={primaryButtonClass}
                style={crmRadius}
                disabled={!file || reading}
                onClick={() => void openReview()}
              >
                {reading ? "Reading the file." : "Review rows"}
              </button>
            </div>
            {file ? <p className={crmMuted}>Selected file: {file.name}</p> : null}
          </div>
        ) : null}

        {step === "review" && sourceKind ? (
          <div className="mt-4 space-y-4">
            <p className={crmMuted}>
              {fileName} · {sourceKindLabel(sourceKind)} · {activeRows.length} rows
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[var(--ts-ink-muted-on-paper)]">
                    <th scope="col" className="px-2 py-2 font-medium">Show name</th>
                    <th scope="col" className="px-2 py-2 font-medium">Flight start</th>
                    <th scope="col" className="px-2 py-2 font-medium">Flight end</th>
                    <th scope="col" className="px-2 py-2 font-medium">Placement</th>
                    <th scope="col" className="px-2 py-2 font-medium">Price type</th>
                    <th scope="col" className="px-2 py-2 font-medium">Price</th>
                    <th scope="col" className="px-2 py-2 font-medium">Episodes</th>
                    <th scope="col" className="px-2 py-2 font-medium">Spend</th>
                    <th scope="col" className="px-2 py-2 font-medium">Conversions</th>
                    <th scope="col" className="px-2 py-2 font-medium">Downloads</th>
                    <th scope="col" className="px-2 py-2 font-medium">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeRows.map((row, index) => (
                    <ReviewRowCells
                      key={row.id}
                      row={row}
                      index={index}
                      suggestion={catalogSuggestionLabel(row.showName, hints)}
                      errors={fieldErrors.filter((item) => item.id === row.id)}
                      onChange={(patch) => updateRow(row.id, patch)}
                      onBlurName={(showName) => {
                        const next = rows.map((item) =>
                          item.id === row.id ? { ...item, showName } : item
                        );
                        void refreshHints(next);
                      }}
                      onRemove={() => {
                        const next = rows.map((item) =>
                          item.id === row.id ? { ...item, removed: true } : item
                        );
                        setRows(next);
                        setFieldErrors((current) => current.filter((item) => item.id !== row.id));
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {activeRows.length === 0 ? (
              <p className={crmMuted}>No rows left. Discard this import or start over.</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={primaryButtonClass}
                style={crmRadius}
                disabled={activeRows.length === 0}
                onClick={continueToConsent}
              >
                Continue to consent
              </button>
              <button
                type="button"
                className={ghostButtonClass}
                style={crmRadius}
                onClick={() => {
                  setError(null);
                  setStep("discarded");
                }}
              >
                Discard import
              </button>
              <button
                type="button"
                className={ghostButtonClass}
                style={crmRadius}
                onClick={() => {
                  setError(null);
                  setStep("upload");
                }}
              >
                Back
              </button>
            </div>
          </div>
        ) : null}

        {step === "consent" ? (
          <form
            className={`${crmCard} mt-4 space-y-4`}
            style={crmRadius}
            onSubmit={(event) => {
              event.preventDefault();
              void confirmImport();
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
              <button
                type="submit"
                className={primaryButtonClass}
                style={crmRadius}
                disabled={saving}
              >
                {saving ? "Saving." : "Confirm import"}
              </button>
              <button
                type="button"
                className={ghostButtonClass}
                style={crmRadius}
                onClick={() => {
                  setError(null);
                  setStep("review");
                }}
              >
                Back
              </button>
              <button
                type="button"
                className={ghostButtonClass}
                style={crmRadius}
                onClick={() => {
                  setError(null);
                  setStep("discarded");
                }}
              >
                Discard import
              </button>
            </div>
          </form>
        ) : null}

        {step === "confirmed" && sourceKind ? (
          <ConfirmedSummary
            fileName={fileName}
            sourceKind={sourceKind}
            consent={consent}
            rows={activeRows}
            hints={hints}
            savedCount={savedCount}
            onReset={reset}
          />
        ) : null}

        {step === "discarded" ? (
          <div className={`${crmCard} mt-4 space-y-3`} style={crmRadius}>
            <StatusPill>Discarded</StatusPill>
            <p>Nothing from {fileName ?? file?.name ?? "this file"} was saved.</p>
            <button type="button" className={primaryButtonClass} style={crmRadius} onClick={reset}>
              Start over
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReviewRowCells({
  row,
  index,
  suggestion,
  errors,
  onChange,
  onBlurName,
  onRemove,
}: {
  row: ReviewRow;
  index: number;
  suggestion: string;
  errors: ReviewFieldError[];
  onChange: (patch: Partial<ReviewRow>) => void;
  onBlurName: (showName: string) => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  const priceError = errors.find((item) => item.field === "price");
  return (
    <tr className="align-top border-t border-[var(--ts-hairline-on-paper)]">
      <td className="px-2 py-3">
        <input
          id={`show-${row.id}`}
          className={fieldClass}
          style={crmRadius}
          value={row.showName}
          aria-label={`Show name ${n}`}
          onChange={(event) => onChange({ showName: event.target.value })}
          onBlur={(event) => onBlurName(event.currentTarget.value)}
        />
        <p className={`mt-2 ${crmMuted}`} data-testid={`match-${row.id}`}>
          {suggestion}
        </p>
      </td>
      <td className="px-2 py-3">
        <input
          type="date"
          className={fieldClass}
          style={crmRadius}
          aria-label={`Flight start ${n}`}
          value={row.flightStart}
          onChange={(event) => onChange({ flightStart: event.target.value })}
        />
      </td>
      <td className="px-2 py-3">
        <input
          type="date"
          className={fieldClass}
          style={crmRadius}
          aria-label={`Flight end ${n}`}
          value={row.flightEnd}
          onChange={(event) => onChange({ flightEnd: event.target.value })}
        />
      </td>
      <td className="px-2 py-3">
        <select
          className={fieldClass}
          style={crmRadius}
          aria-label={`Placement ${n}`}
          value={row.placement}
          onChange={(event) => onChange({ placement: event.target.value })}
        >
          <option value="">Unset</option>
          {placementChoices(row.placement).map((value) => (
            <option key={value} value={value}>
              {placementLabel(value)}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-3">
        <select
          className={fieldClass}
          style={crmRadius}
          aria-label={`Price type ${n}`}
          value={row.priceType}
          onChange={(event) =>
            onChange({ priceType: event.target.value as ReviewRow["priceType"] })
          }
        >
          <option value="">Unset</option>
          <option value="cpm">CPM</option>
          <option value="flat">Flat rate</option>
        </select>
      </td>
      <td className="px-2 py-3">
        <input
          className={fieldClass}
          style={crmRadius}
          inputMode="decimal"
          aria-label={`Price ${n}`}
          aria-invalid={priceError ? true : undefined}
          value={row.price}
          onChange={(event) => onChange({ price: event.target.value })}
        />
        {priceError ? (
          <p className="mt-1 text-xs text-[var(--ts-accent-text)]">{priceError.message}</p>
        ) : null}
      </td>
      <td className="px-2 py-3">
        <input
          className={fieldClass}
          style={crmRadius}
          inputMode="numeric"
          aria-label={`Episodes ${n}`}
          value={row.episodes}
          onChange={(event) => onChange({ episodes: event.target.value })}
        />
      </td>
      <td className="px-2 py-3">
        <input
          className={fieldClass}
          style={crmRadius}
          inputMode="decimal"
          aria-label={`Spend ${n}`}
          value={row.spend}
          onChange={(event) => onChange({ spend: event.target.value })}
        />
      </td>
      <td className="px-2 py-3">
        <input
          className={fieldClass}
          style={crmRadius}
          inputMode="numeric"
          aria-label={`Conversions ${n}`}
          value={row.conversions}
          onChange={(event) => onChange({ conversions: event.target.value })}
        />
      </td>
      <td className="px-2 py-3">
        <input
          className={fieldClass}
          style={crmRadius}
          inputMode="numeric"
          aria-label={`Downloads ${n}`}
          value={row.downloads}
          onChange={(event) => onChange({ downloads: event.target.value })}
        />
      </td>
      <td className="px-2 py-3">
        <button
          type="button"
          className={ghostButtonClass}
          style={crmRadius}
          onClick={onRemove}
        >
          Remove
        </button>
      </td>
    </tr>
  );
}

function ConfirmedSummary({
  fileName,
  sourceKind,
  consent,
  rows,
  hints,
  savedCount,
  onReset,
}: {
  fileName: string | null;
  sourceKind: ReviewSourceKind;
  consent: boolean;
  rows: ReviewRow[];
  hints: CatalogHint[];
  savedCount: number;
  onReset: () => void;
}) {
  return (
    <div className="mt-4 space-y-4" data-testid="import-confirmed">
      <div className={crmCard} style={crmRadius}>
        <StatusPill>Confirmed</StatusPill>
        <p className="mt-3 font-medium">{fileName}</p>
        <p className={crmMuted}>{sourceKindLabel(sourceKind)}</p>
        <p className="mt-3">{recordCountLabel(savedCount)}</p>
        <p className="mt-3">
          {consent
            ? `Pooling consent: yes. Terms version ${POOLING_TERMS_VERSION}.`
            : "Pooling consent: no. This file stays private to the brand."}
        </p>
      </div>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className={crmCard} style={crmRadius}>
            <p className="font-medium">{row.showName}</p>
            <p className={crmMuted}>
              {flightText(row.flightStart, row.flightEnd)}
              {row.placement ? ` · ${placementLabel(row.placement)}` : ""}
              {row.priceType ? ` · ${priceTypeLabel(row.priceType)}` : ""}
            </p>
            <p className={`mt-1 ${crmMuted}`}>{catalogSuggestionLabel(row.showName, hints)}</p>
          </li>
        ))}
      </ul>
      <button type="button" className={primaryButtonClass} style={crmRadius} onClick={onReset}>
        Start over
      </button>
    </div>
  );
}

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

function flightText(start: string, end: string): string {
  if (!start && !end) return "Flight not set";
  if (start && end) return `${formatDay(start)} to ${formatDay(end)}`;
  return formatDay(start || end);
}

function formatDay(value: string): string {
  const iso = value.length === 10 ? `${value}T00:00:00Z` : value;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
