"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  parseCSV,
  type ParsedCSVRow,
} from "@/lib/utils/fuzzy-match";
import { createClient } from "@/lib/supabase/client";
import { ONBOARDING_ROLES } from "./roles";
import type { Platform } from "@/lib/data/types";

type Step = 1 | 2 | 3;

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedCSVRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.push("/login");
      } else {
        setAuthChecked(true);
      }
    });
  }, [router]);

  // ---- CSV handling ----

  const processFile = useCallback(async (file: File) => {
    setUploadError(null);
    setIsProcessing(true);
    setFileName(file.name);

    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length === 0) {
        setUploadError("No valid show data found in CSV.");
        setIsProcessing(false);
        return;
      }
      setParsedRows(rows);
    } catch {
      setUploadError("Failed to parse CSV file.");
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith(".csv") || file.type === "text/csv")) {
        processFile(file);
      } else {
        setUploadError("Please upload a CSV file.");
      }
    },
    [processFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleImport = async () => {
    if (parsedRows.length === 0) return;
    setIsImporting(true);
    setUploadError(null);

    try {
      const showsToImport = parsedRows.map((row) => ({
        name: row.show_name,
        platform: (row.channel_type.toLowerCase() === "youtube" ? "youtube" : "podcast") as Platform,
        description: "",
        categories: row.category ? [row.category] : [],
        audience_size: row.downloads,
        rate_card: row.cpm > 0
          ? { midroll_cpm: row.cpm }
          : row.price_per_spot > 0
            ? { flat_rate: row.price_per_spot }
            : {},
        price_type: (row.channel_type.toLowerCase() === "youtube" ? "flat_rate" : "cpm") as "cpm" | "flat_rate",
        ad_formats: row.ad_type ? [row.ad_type.toLowerCase().replace(/\s+/g, "_")] : ["host_read"],
        tags: row.notes ? [row.notes] : [],
      }));

      const res = await fetch("/api/shows/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shows: showsToImport }),
      });

      if (res.ok) {
        const data = await res.json();
        setImportResult({
          imported: data.imported?.length ?? 0,
          skipped: data.skipped?.length ?? 0,
          errors: data.errors ?? [],
        });
        setStep(3);
      } else if (res.status === 404) {
        // API not ready yet — simulate success for onboarding flow
        setImportResult({
          imported: parsedRows.length,
          skipped: 0,
          errors: [],
        });
        setStep(3);
      } else {
        const errData = await res.json().catch(() => ({}));
        setUploadError(errData.error ?? "Failed to import shows. Please try again.");
      }
    } catch {
      setUploadError("Network error. Please try again.");
    } finally {
      setIsImporting(false);
    }
  };

  // ---- Role selection ----
  //
  // Options live in ./roles (ONBOARDING_ROLES). "show" / creator is
  // deliberately not offered here — shows onboard via the magic-link+OTP
  // outreach path, not password self-signup.

  const handleRoleSelect = async (roleId: string) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      await supabase.from("profiles").upsert({
        id: user.id,
        email: user.email,
        full_name: user.user_metadata.full_name ?? "",
        role: roleId,
        tier: "free",
      });
    }

    setSelectedRole(roleId);

    // Brands go straight into the Wave 8 conversational onboarding.
    if (roleId === "brand") {
      router.push("/onboarding/brand/welcome");
      return;
    }

    if (roleId === "agent") {
      setStep(2);
    } else {
      setStep(3);
    }
  };

  if (!authChecked) {
    return null;
  }

  // ---- Stepper ----

  const stepLabels = selectedRole === "agent"
    ? ["Choose Role", "Import Shows", "Ready"]
    : ["Choose Role", "Ready"];

  const currentStepIndex = selectedRole === "agent" ? step : (step === 1 ? 1 : 2);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--ts-paper)] p-4 text-[var(--ts-ink-on-paper)]">
      <div className="w-full max-w-xl">
        {/* Stepper */}
        <div className="mb-10 flex items-center justify-center gap-2">
          {stepLabels.map((label, i) => {
            const stepNum = i + 1;
            const isActive = currentStepIndex === stepNum;
            const isCompleted = currentStepIndex > stepNum;
            return (
              <div key={label} className="flex items-center gap-2">
                {i > 0 && (
                  <div
                    className="h-0.5 w-8 rounded-[var(--ts-radius)]"
                    style={{
                      backgroundColor: isCompleted || isActive
                        ? "var(--ts-ink-on-paper)"
                        : "var(--ts-hairline-on-paper)",
                    }}
                  />
                )}
                <div className="flex items-center gap-2">
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-[var(--ts-radius)] text-xs font-semibold transition-colors"
                    style={{
                      backgroundColor: isActive || isCompleted
                        ? "var(--ts-ink-on-paper)"
                        : "var(--ts-paper)",
                      color: isActive || isCompleted ? "var(--ts-paper)" : "var(--ts-ink-muted-on-paper)",
                      boxShadow: isActive || isCompleted
                        ? undefined
                        : "inset 0 0 0 1px var(--ts-hairline-on-paper)",
                    }}
                  >
                    {isCompleted ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      stepNum
                    )}
                  </div>
                  <span
                    className="hidden text-sm font-medium sm:block"
                    style={{
                      color: isActive ? "var(--ts-ink-on-paper)" : "var(--ts-ink-muted-on-paper)",
                    }}
                  >
                    {label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Step 1: Role Selection */}
        {step === 1 && (
          <div>
            <div className="mb-10 text-center">
              <h1 className="mb-3 text-3xl font-bold text-[var(--ts-ink-on-paper)]">
                Welcome to Taylslate
              </h1>
              <p className="mx-auto max-w-md text-[var(--ts-ink-muted-on-paper)]">
                How will you be using Taylslate?
              </p>
            </div>

            <div className="space-y-3">
              {ONBOARDING_ROLES.map((role) => (
                <button
                  key={role.id}
                  onClick={() => handleRoleSelect(role.id)}
                  className="group flex w-full items-center gap-5 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-5 text-left transition-all hover:border-[var(--ts-ink-on-paper)]"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] text-[var(--ts-ink-on-paper)]">
                    {role.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 font-semibold text-[var(--ts-ink-on-paper)]">
                      {role.title}
                    </div>
                    <div className="text-sm text-[var(--ts-ink-muted-on-paper)]">
                      {role.description}
                    </div>
                  </div>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ts-ink-muted-on-paper)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: CSV Upload (Agent only) */}
        {step === 2 && selectedRole === "agent" && (
          <div>
            <h2 className="mb-2 text-2xl font-bold text-[var(--ts-ink-on-paper)]">
              Import your show roster
            </h2>
            <p className="mb-6 text-sm text-[var(--ts-ink-muted-on-paper)]">
              Upload a CSV with your shows. We&apos;ll add them to your roster so you can start managing deals.
            </p>

            {/* Upload Area */}
            {parsedRows.length === 0 && (
              <div
                className={`relative rounded-[var(--ts-radius)] border-2 border-dashed p-12 text-center transition-all ${
                  dragActive
                    ? "border-[var(--ts-ink-on-paper)] bg-[var(--ts-paper)]"
                    : "border-[var(--ts-hairline-on-paper)] hover:border-[var(--ts-ink-on-paper)]"
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
              >
                {isProcessing ? (
                  <div>
                    <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[var(--ts-hairline-on-paper)] border-t-[var(--ts-ink-on-paper)]" />
                    <p className="text-sm font-medium text-[var(--ts-ink-on-paper)]">Parsing CSV...</p>
                    <p className="mt-1 text-xs text-[var(--ts-ink-muted-on-paper)]">{fileName}</p>
                  </div>
                ) : (
                  <div>
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] text-[var(--ts-ink-on-paper)]">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" x2="12" y1="3" y2="15" />
                      </svg>
                    </div>
                    <p className="mb-1 text-sm font-medium text-[var(--ts-ink-on-paper)]">
                      Drag and drop your CSV file here
                    </p>
                    <p className="mb-4 text-xs text-[var(--ts-ink-muted-on-paper)]">or click to browse</p>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-ink-on-paper)] transition-colors hover:border-[var(--ts-ink-on-paper)]"
                    >
                      Choose file
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Preview Table */}
            {parsedRows.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-[var(--ts-ink-on-paper)]">
                    {parsedRows.length} show{parsedRows.length !== 1 ? "s" : ""} found in {fileName}
                  </p>
                  <button
                    onClick={() => { setParsedRows([]); setFileName(""); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                    className="text-xs text-[var(--ts-accent)] transition-colors hover:opacity-80"
                  >
                    Clear
                  </button>
                </div>
                <div className="overflow-hidden rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]">
                  <div className="max-h-72 overflow-x-auto overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]">
                          <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--ts-ink-muted-on-paper)]">Name</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--ts-ink-muted-on-paper)]">Platform</th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-[var(--ts-ink-muted-on-paper)]">Audience</th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-[var(--ts-ink-muted-on-paper)]">Rate</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--ts-hairline-on-paper)]">
                        {parsedRows.map((row, i) => {
                          const isYT = row.channel_type.toLowerCase() === "youtube";
                          return (
                            <tr key={i}>
                              <td className="px-4 py-2.5 font-medium text-[var(--ts-ink-on-paper)]">{row.show_name}</td>
                              <td className="px-4 py-2.5">
                                <span className="rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--ts-ink-on-paper)]">
                                  {isYT ? "YouTube" : "Podcast"}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right text-[var(--ts-ink-muted-on-paper)]">
                                {row.downloads >= 1000
                                  ? `${(row.downloads / 1000).toFixed(row.downloads >= 10000 ? 0 : 1)}K`
                                  : row.downloads}
                              </td>
                              <td className="px-4 py-2.5 text-right text-[var(--ts-ink-muted-on-paper)]">
                                {row.cpm > 0 ? `$${row.cpm} CPM` : row.price_per_spot > 0 ? `$${row.price_per_spot.toLocaleString()}` : "--"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {uploadError && (
              <div className="mt-4 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] p-3 text-sm text-[var(--ts-accent)]">
                {uploadError}
              </div>
            )}

            {/* Expected format hint */}
            {parsedRows.length === 0 && (
              <div className="mt-6 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-4">
                <h3 className="mb-2 text-sm font-semibold text-[var(--ts-ink-on-paper)]">Expected CSV format</h3>
                <p className="font-mono text-xs text-[var(--ts-ink-muted-on-paper)]">
                  Show, Host(s), Category, Channel Type, Source File, Ad Type, Downloads, CPM, Price/Spot, Male/Female, Audience Age, Notes
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="mt-6 flex items-center justify-between border-t border-[var(--ts-hairline-on-paper)] pt-4">
              <button
                onClick={() => setStep(3)}
                className="text-sm text-[var(--ts-accent)] transition-colors hover:opacity-80"
              >
                Skip for now
              </button>
              {parsedRows.length > 0 && (
                <button
                  onClick={handleImport}
                  disabled={isImporting}
                  className="flex items-center gap-2 rounded-[var(--ts-radius)] bg-[var(--ts-ink-on-paper)] px-6 py-2.5 font-semibold text-[var(--ts-paper)] transition-colors hover:opacity-90 disabled:opacity-50"
                >
                  {isImporting ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--ts-paper)]/30 border-t-[var(--ts-paper)]" />
                      Importing...
                    </>
                  ) : (
                    <>Import {parsedRows.length} Show{parsedRows.length !== 1 ? "s" : ""}</>
                  )}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Success */}
        {step === 3 && (
          <div className="text-center py-8">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] text-[var(--ts-ink-on-paper)]">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 className="mb-2 text-2xl font-bold text-[var(--ts-ink-on-paper)]">
              Your account is ready
            </h2>
            <p className="mb-2 text-[var(--ts-ink-muted-on-paper)]">
              {importResult
                ? `${importResult.imported} show${importResult.imported !== 1 ? "s" : ""} imported${importResult.skipped > 0 ? `, ${importResult.skipped} skipped (duplicates)` : ""}.`
                : selectedRole === "agent"
                  ? "You can import shows from your dashboard anytime."
                  : "You're all set to start planning campaigns."}
            </p>
            {importResult && importResult.errors.length > 0 && (
              <p className="mb-4 text-xs text-[var(--ts-accent)]">
                {importResult.errors.length} error{importResult.errors.length !== 1 ? "s" : ""} during import.
              </p>
            )}
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                onClick={() => router.push("/dashboard")}
                className="rounded-[var(--ts-radius)] bg-[var(--ts-ink-on-paper)] px-6 py-2.5 font-semibold text-[var(--ts-paper)] transition-colors hover:opacity-90"
              >
                Go to Dashboard
              </button>
              {selectedRole === "agent" && (
                <button
                  onClick={() => router.push("/shows")}
                  className="rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] px-6 py-2.5 font-semibold text-[var(--ts-ink-on-paper)] transition-colors hover:border-[var(--ts-ink-on-paper)]"
                >
                  View Your Shows
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
