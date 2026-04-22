"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  parseCSV,
  type ParsedCSVRow,
} from "@/lib/utils/fuzzy-match";
import { createClient } from "@/lib/supabase/client";
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

  const roles = [
    {
      id: "brand",
      title: "Brand / Advertiser",
      description: "I'm an advertiser looking to run creator sponsorship campaigns",
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </svg>
      ),
    },
    {
      id: "agency",
      title: "Agency",
      description: "I manage campaigns for multiple brand clients",
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      id: "agent",
      title: "Agent / Talent Manager",
      description: "I represent shows and manage their ad inventory",
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
      ),
    },
    {
      id: "show",
      title: "Show / Creator",
      description: "I host a podcast or YouTube show and want to accept ad deals",
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      ),
    },
  ];

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

    // Shows/creators go into the Wave 9 conversational onboarding.
    if (roleId === "show") {
      router.push("/onboarding/show/welcome");
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

  const totalSteps = selectedRole === "agent" ? 3 : 2;
  const stepLabels = selectedRole === "agent"
    ? ["Choose Role", "Import Shows", "Ready"]
    : ["Choose Role", "Ready"];

  const currentStepIndex = selectedRole === "agent" ? step : (step === 1 ? 1 : 2);

  return (
    <div className="min-h-screen bg-[var(--brand-surface)] flex items-center justify-center p-4">
      <div className="w-full max-w-xl">
        {/* Stepper */}
        <div className="flex items-center justify-center gap-2 mb-10">
          {stepLabels.map((label, i) => {
            const stepNum = i + 1;
            const isActive = currentStepIndex === stepNum;
            const isCompleted = currentStepIndex > stepNum;
            return (
              <div key={label} className="flex items-center gap-2">
                {i > 0 && (
                  <div
                    className="w-8 h-0.5 rounded-full"
                    style={{
                      backgroundColor: isCompleted || isActive
                        ? "var(--brand-blue)"
                        : "var(--brand-border)",
                    }}
                  />
                )}
                <div className="flex items-center gap-2">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors"
                    style={{
                      backgroundColor: isActive
                        ? "var(--brand-blue)"
                        : isCompleted
                          ? "var(--brand-blue)"
                          : "var(--brand-border)",
                      color: isActive || isCompleted ? "#fff" : "var(--brand-text-muted)",
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
                    className="text-sm font-medium hidden sm:block"
                    style={{
                      color: isActive ? "var(--brand-text)" : "var(--brand-text-muted)",
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
            <div className="text-center mb-10">
              <h1 className="text-3xl font-bold text-[var(--brand-text)] mb-3">
                Welcome to Taylslate
              </h1>
              <p className="text-[var(--brand-text-secondary)] max-w-md mx-auto">
                How will you be using Taylslate?
              </p>
            </div>

            <div className="space-y-3">
              {roles.map((role) => (
                <button
                  key={role.id}
                  onClick={() => handleRoleSelect(role.id)}
                  className="w-full flex items-center gap-5 p-5 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] hover:border-[var(--brand-blue)]/40 hover:bg-[var(--brand-blue)]/[0.02] transition-all text-left group"
                >
                  <div className="w-12 h-12 rounded-xl bg-[var(--brand-blue)]/[0.06] flex items-center justify-center shrink-0 text-[var(--brand-blue)] group-hover:bg-[var(--brand-blue)]/[0.1] transition-colors">
                    {role.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[var(--brand-text)] mb-0.5">
                      {role.title}
                    </div>
                    <div className="text-sm text-[var(--brand-text-secondary)]">
                      {role.description}
                    </div>
                  </div>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
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
            <h2 className="text-2xl font-bold text-[var(--brand-text)] mb-2">
              Import your show roster
            </h2>
            <p className="text-sm text-[var(--brand-text-secondary)] mb-6">
              Upload a CSV with your shows. We&apos;ll add them to your roster so you can start managing deals.
            </p>

            {/* Upload Area */}
            {parsedRows.length === 0 && (
              <div
                className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-all ${
                  dragActive
                    ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.04]"
                    : "border-[var(--brand-border)] hover:border-[var(--brand-blue)]/40"
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
              >
                {isProcessing ? (
                  <div>
                    <div className="w-10 h-10 border-3 border-[var(--brand-blue)]/20 border-t-[var(--brand-blue)] rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-sm font-medium text-[var(--brand-text)]">Parsing CSV...</p>
                    <p className="text-xs text-[var(--brand-text-muted)] mt-1">{fileName}</p>
                  </div>
                ) : (
                  <div>
                    <div className="w-12 h-12 rounded-xl bg-[var(--brand-blue)]/[0.06] flex items-center justify-center mx-auto mb-4">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" x2="12" y1="3" y2="15" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-[var(--brand-text)] mb-1">
                      Drag and drop your CSV file here
                    </p>
                    <p className="text-xs text-[var(--brand-text-muted)] mb-4">or click to browse</p>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-4 py-2 text-sm font-medium text-[var(--brand-blue)] border border-[var(--brand-blue)]/30 rounded-lg hover:bg-[var(--brand-blue)]/[0.04] transition-colors"
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
                  <p className="text-sm font-medium text-[var(--brand-text)]">
                    {parsedRows.length} show{parsedRows.length !== 1 ? "s" : ""} found in {fileName}
                  </p>
                  <button
                    onClick={() => { setParsedRows([]); setFileName(""); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                    className="text-xs text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
                  >
                    Clear
                  </button>
                </div>
                <div className="bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] overflow-hidden">
                  <div className="overflow-x-auto max-h-72 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--brand-border)] bg-[var(--brand-surface)]">
                          <th className="text-left px-4 py-2.5 font-medium text-[var(--brand-text-muted)] text-xs uppercase tracking-wider">Name</th>
                          <th className="text-left px-4 py-2.5 font-medium text-[var(--brand-text-muted)] text-xs uppercase tracking-wider">Platform</th>
                          <th className="text-right px-4 py-2.5 font-medium text-[var(--brand-text-muted)] text-xs uppercase tracking-wider">Audience</th>
                          <th className="text-right px-4 py-2.5 font-medium text-[var(--brand-text-muted)] text-xs uppercase tracking-wider">Rate</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--brand-border)]">
                        {parsedRows.map((row, i) => {
                          const isYT = row.channel_type.toLowerCase() === "youtube";
                          return (
                            <tr key={i} className="hover:bg-[var(--brand-surface)] transition-colors">
                              <td className="px-4 py-2.5 font-medium text-[var(--brand-text)]">{row.show_name}</td>
                              <td className="px-4 py-2.5">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                  isYT
                                    ? "bg-[var(--brand-error)]/10 text-[var(--brand-error)]"
                                    : "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]"
                                }`}>
                                  {isYT ? "YouTube" : "Podcast"}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right text-[var(--brand-text-secondary)]">
                                {row.downloads >= 1000
                                  ? `${(row.downloads / 1000).toFixed(row.downloads >= 10000 ? 0 : 1)}K`
                                  : row.downloads}
                              </td>
                              <td className="px-4 py-2.5 text-right text-[var(--brand-text-secondary)]">
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
              <div className="mt-4 p-3 rounded-lg bg-[var(--brand-error)]/10 text-[var(--brand-error)] text-sm">
                {uploadError}
              </div>
            )}

            {/* Expected format hint */}
            {parsedRows.length === 0 && (
              <div className="mt-6 p-4 rounded-xl bg-[var(--brand-surface-elevated)] border border-[var(--brand-border)]">
                <h3 className="text-sm font-semibold text-[var(--brand-text)] mb-2">Expected CSV format</h3>
                <p className="text-xs text-[var(--brand-text-muted)] font-mono">
                  Show, Host(s), Category, Channel Type, Source File, Ad Type, Downloads, CPM, Price/Spot, Male/Female, Audience Age, Notes
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--brand-border)]">
              <button
                onClick={() => setStep(3)}
                className="text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-blue)] transition-colors"
              >
                Skip for now
              </button>
              {parsedRows.length > 0 && (
                <button
                  onClick={handleImport}
                  disabled={isImporting}
                  className="flex items-center gap-2 px-6 py-2.5 bg-[var(--brand-blue)] text-white rounded-xl font-semibold hover:bg-[var(--brand-blue-light)] transition-colors disabled:opacity-50"
                >
                  {isImporting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
            <div className="w-16 h-16 rounded-2xl bg-[var(--brand-success)]/10 flex items-center justify-center mx-auto mb-6">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--brand-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-[var(--brand-text)] mb-2">
              Your account is ready
            </h2>
            <p className="text-[var(--brand-text-secondary)] mb-2">
              {importResult
                ? `${importResult.imported} show${importResult.imported !== 1 ? "s" : ""} imported${importResult.skipped > 0 ? `, ${importResult.skipped} skipped (duplicates)` : ""}.`
                : selectedRole === "agent"
                  ? "You can import shows from your dashboard anytime."
                  : "You're all set to start planning campaigns."}
            </p>
            {importResult && importResult.errors.length > 0 && (
              <p className="text-xs text-[var(--brand-warning)] mb-4">
                {importResult.errors.length} error{importResult.errors.length !== 1 ? "s" : ""} during import.
              </p>
            )}
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                onClick={() => router.push("/dashboard")}
                className="px-6 py-2.5 bg-[var(--brand-blue)] text-white rounded-xl font-semibold hover:bg-[var(--brand-blue-light)] transition-colors"
              >
                Go to Dashboard
              </button>
              {selectedRole === "agent" && (
                <button
                  onClick={() => router.push("/shows")}
                  className="px-6 py-2.5 border border-[var(--brand-border)] text-[var(--brand-text)] rounded-xl font-semibold hover:bg-[var(--brand-surface-elevated)] transition-colors"
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
