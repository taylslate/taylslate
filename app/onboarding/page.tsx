"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { shows } from "@/lib/data";
import {
  parseCSV,
  matchCSVToShows,
  type ShowMatchResult,
} from "@/lib/utils/fuzzy-match";
import { createClient } from "@/lib/supabase/client";

type Step = "role" | "welcome" | "upload" | "review" | "complete";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("role");
  const [matchResults, setMatchResults] = useState<ShowMatchResult[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Check auth on mount — redirect to /login if not authenticated
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

  const processFile = useCallback(
    async (file: File) => {
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

        // Small delay to let UI update
        await new Promise((r) => setTimeout(r, 50));

        const results = matchCSVToShows(rows, shows);
        setMatchResults(results);

        // Select all matched shows by default
        const defaultSelected = new Set<number>();
        results.forEach((r, i) => {
          if (!r.is_new) defaultSelected.add(i);
        });
        setSelectedIds(defaultSelected);
        setStep("review");
      } catch {
        setUploadError("Failed to parse CSV file.");
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

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

  // ---- Review actions ----

  const toggleShow = (index: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    if (checked) {
      const all = new Set<number>();
      matchResults.forEach((_, i) => all.add(i));
      setSelectedIds(all);
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleConfirm = () => {
    setStep("complete");
  };

  // ---- Derived data ----

  const matched = matchResults.filter((r) => !r.is_new);
  const newShows = matchResults.filter((r) => r.is_new);
  const selectedCount = selectedIds.size;

  // ---- Role selection cards ----

  const roles = [
    {
      id: "brand",
      title: "Brand / Advertiser",
      description:
        "I'm an advertiser looking to run creator sponsorship campaigns",
      icon: (
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
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
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
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
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
      ),
    },
  ];

  // ---- Render ----

  const handleRoleSelect = async (roleId: string) => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await supabase.from("profiles").upsert({
        id: user.id,
        email: user.email,
        full_name: user.user_metadata.full_name ?? "",
        role: roleId,
        tier: "free",
      });
    }

    if (roleId === "agent") {
      setStep("welcome");
    } else {
      router.push("/campaigns/new");
    }
  };

  if (!authChecked) {
    return null;
  }

  if (step === "role") {
    return (
      <div className="py-12">
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
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--brand-text-muted)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (step === "welcome") {
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--brand-blue)] to-[var(--brand-teal)] flex items-center justify-center mx-auto mb-6">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-[var(--brand-text)] mb-3">
          Welcome to Taylslate
        </h1>
        <p className="text-[var(--brand-text-secondary)] max-w-md mx-auto mb-8 leading-relaxed">
          The fastest way to manage your show roster, send IOs, and get paid.
          Start by importing your show roster so we can match your shows to our
          database.
        </p>
        <button
          onClick={() => setStep("upload")}
          className="px-6 py-3 bg-[var(--brand-blue)] text-white rounded-xl font-semibold hover:bg-[var(--brand-blue-light)] transition-colors"
        >
          Upload your show roster
        </button>
        <div className="mt-4">
          <button
            onClick={() => router.push("/shows")}
            className="text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-blue)] transition-colors"
          >
            I&apos;ll add shows manually later
          </button>
        </div>
      </div>
    );
  }

  if (step === "upload") {
    return (
      <div>
        <button
          onClick={() => setStep("welcome")}
          className="flex items-center gap-1.5 text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] mb-6 transition-colors"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <h2 className="text-2xl font-bold text-[var(--brand-text)] mb-2">
          Upload your roster
        </h2>
        <p className="text-sm text-[var(--brand-text-secondary)] mb-6">
          Upload a CSV with your shows. We&apos;ll match them against our
          database of 400+ podcasts and YouTube channels.
        </p>

        <div
          className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-all ${
            dragActive
              ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.04]"
              : "border-[var(--brand-border)] hover:border-[var(--brand-blue)]/40"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
        >
          {isProcessing ? (
            <div>
              <div className="w-10 h-10 border-3 border-[var(--brand-blue)]/20 border-t-[var(--brand-blue)] rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm font-medium text-[var(--brand-text)]">
                Matching shows...
              </p>
              <p className="text-xs text-[var(--brand-text-muted)] mt-1">
                {fileName}
              </p>
            </div>
          ) : (
            <div>
              <div className="w-12 h-12 rounded-xl bg-[var(--brand-blue)]/[0.06] flex items-center justify-center mx-auto mb-4">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--brand-blue)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" x2="12" y1="3" y2="15" />
                </svg>
              </div>
              <p className="text-sm font-medium text-[var(--brand-text)] mb-1">
                Drag and drop your CSV file here
              </p>
              <p className="text-xs text-[var(--brand-text-muted)] mb-4">
                or click to browse
              </p>
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

        {uploadError && (
          <div className="mt-4 p-3 rounded-lg bg-[var(--brand-error)]/10 text-[var(--brand-error)] text-sm">
            {uploadError}
          </div>
        )}

        <div className="mt-6 p-4 rounded-xl bg-[var(--brand-surface-elevated)] border border-[var(--brand-border)]">
          <h3 className="text-sm font-semibold text-[var(--brand-text)] mb-2">
            Expected CSV format
          </h3>
          <p className="text-xs text-[var(--brand-text-muted)] font-mono">
            Show, Host(s), Category, Channel Type, Source File, Ad Type,
            Downloads, CPM, Price/Spot, Male/Female, Audience Age, Notes
          </p>
        </div>
      </div>
    );
  }

  if (step === "review") {
    return (
      <div>
        <button
          onClick={() => setStep("upload")}
          className="flex items-center gap-1.5 text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] mb-6 transition-colors"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-[var(--brand-text)]">
              Review matches
            </h2>
            <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
              {matchResults.length} shows found in CSV &middot; {matched.length}{" "}
              matched &middot; {newShows.length} new
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--brand-text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={selectedIds.size === matchResults.length}
              onChange={(e) => toggleAll(e.target.checked)}
              className="rounded border-[var(--brand-border)]"
            />
            Select all
          </label>
        </div>

        {/* Matched shows */}
        {matched.length > 0 && (
          <div className="mb-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--brand-text-muted)] mb-3">
              Matched Shows ({matched.length})
            </h3>
            <div className="space-y-2">
              {matchResults.map(
                (result, i) =>
                  !result.is_new && (
                    <MatchRow
                      key={i}
                      result={result}
                      index={i}
                      selected={selectedIds.has(i)}
                      onToggle={() => toggleShow(i)}
                    />
                  )
              )}
            </div>
          </div>
        )}

        {/* New shows */}
        {newShows.length > 0 && (
          <div className="mb-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--brand-text-muted)] mb-3">
              New Shows ({newShows.length})
            </h3>
            <p className="text-xs text-[var(--brand-text-muted)] mb-3">
              These shows weren&apos;t found in our database. They can be added
              manually later.
            </p>
            <div className="space-y-2">
              {matchResults.map(
                (result, i) =>
                  result.is_new && (
                    <MatchRow
                      key={i}
                      result={result}
                      index={i}
                      selected={selectedIds.has(i)}
                      onToggle={() => toggleShow(i)}
                    />
                  )
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-[var(--brand-border)]">
          <p className="text-sm text-[var(--brand-text-secondary)]">
            {selectedCount} show{selectedCount !== 1 ? "s" : ""} selected
          </p>
          <button
            onClick={handleConfirm}
            disabled={selectedCount === 0}
            className="px-6 py-2.5 bg-[var(--brand-blue)] text-white rounded-xl font-semibold hover:bg-[var(--brand-blue-light)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Confirm & Import ({selectedCount})
          </button>
        </div>
      </div>
    );
  }

  // step === "complete"
  return (
    <div className="text-center py-16">
      <div className="w-16 h-16 rounded-2xl bg-[var(--brand-success)]/10 flex items-center justify-center mx-auto mb-6">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--brand-success)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h2 className="text-2xl font-bold text-[var(--brand-text)] mb-2">
        Shows Imported
      </h2>
      <p className="text-[var(--brand-text-secondary)] mb-8">
        {selectedCount} show{selectedCount !== 1 ? "s" : ""} added to your
        roster.
      </p>
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => router.push("/dashboard")}
          className="px-6 py-2.5 bg-[var(--brand-blue)] text-white rounded-xl font-semibold hover:bg-[var(--brand-blue-light)] transition-colors"
        >
          Go to Dashboard
        </button>
        <button
          onClick={() => router.push("/shows")}
          className="px-6 py-2.5 border border-[var(--brand-border)] text-[var(--brand-text)] rounded-xl font-semibold hover:bg-[var(--brand-surface-elevated)] transition-colors"
        >
          View Your Shows
        </button>
      </div>
    </div>
  );
}

// ---- Match Row Component ----

function MatchRow({
  result,
  index,
  selected,
  onToggle,
}: {
  result: ShowMatchResult;
  index: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const show = result.matched_show;
  const isPodcast =
    (show?.platform ?? result.csv_row.channel_type.toLowerCase()) !== "youtube";
  const name = show?.name ?? result.csv_row.show_name;
  const audience = show?.audience_size ?? result.csv_row.downloads;
  const dbCpm =
    show?.rate_card.midroll_cpm ?? show?.rate_card.flat_rate ?? null;
  const hasCpmOverride = result.cpm_override !== null;

  const confidenceColor =
    result.match_confidence >= 90
      ? "text-[var(--brand-success)]"
      : result.match_confidence >= 70
        ? "text-[var(--brand-warning)]"
        : result.match_confidence >= 60
          ? "text-[var(--brand-orange)]"
          : "text-[var(--brand-text-muted)]";

  const confidenceLabel = result.is_new
    ? "New"
    : result.match_confidence >= 90
      ? "Exact"
      : result.match_confidence >= 70
        ? "Likely"
        : "Possible";

  return (
    <label
      className={`flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-all ${
        selected
          ? "border-[var(--brand-blue)]/30 bg-[var(--brand-blue)]/[0.02]"
          : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)]"
      } ${result.is_new ? "opacity-70" : ""}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="rounded border-[var(--brand-border)] shrink-0"
      />

      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
          isPodcast
            ? "bg-[var(--brand-blue)]/10"
            : "bg-[var(--brand-error)]/10"
        }`}
      >
        {isPodcast ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--brand-blue)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--brand-error)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-[var(--brand-text)] truncate">
            {name}
          </span>
          {!result.is_new && (
            <span className={`text-[10px] font-semibold ${confidenceColor}`}>
              {confidenceLabel}
            </span>
          )}
          {result.is_new && (
            <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-[var(--brand-text-muted)]/10 text-[var(--brand-text-muted)]">
              New
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-[var(--brand-text-muted)]">
            {audience >= 1000
              ? `${(audience / 1000).toFixed(audience >= 10000 ? 0 : 1)}K`
              : audience}{" "}
            {isPodcast ? "downloads" : "views"}
          </span>
          {result.csv_row.category && (
            <span className="text-xs text-[var(--brand-text-muted)]">
              {result.csv_row.category}
            </span>
          )}
        </div>
      </div>

      <div className="text-right shrink-0">
        {hasCpmOverride ? (
          <div>
            <span className="text-xs text-[var(--brand-text-muted)] line-through mr-1">
              ${dbCpm}
            </span>
            <span className="text-sm font-semibold text-[var(--brand-blue)]">
              ${result.cpm_override}
            </span>
            <div className="text-[10px] text-[var(--brand-blue)]">
              CSV rate
            </div>
          </div>
        ) : dbCpm ? (
          <div>
            <span className="text-sm font-semibold text-[var(--brand-text)]">
              ${dbCpm}
            </span>
            <div className="text-[10px] text-[var(--brand-text-muted)]">
              CPM
            </div>
          </div>
        ) : result.csv_row.cpm > 0 ? (
          <div>
            <span className="text-sm font-semibold text-[var(--brand-text)]">
              ${result.csv_row.cpm}
            </span>
            <div className="text-[10px] text-[var(--brand-text-muted)]">
              CPM
            </div>
          </div>
        ) : null}
      </div>
    </label>
  );
}
