"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { tokens } from "@/lib/brand/tokens";

const radiusStyle = { borderRadius: tokens.radius };
const DEBOUNCE_MS = 300;

const ghostBtnClass =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2 text-sm font-medium hover:bg-[var(--ts-band-shows)] disabled:cursor-not-allowed disabled:opacity-50";
const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const hairline = "border border-[var(--ts-hairline-on-paper)]";

const KNOWN_ERRORS = new Set([
  "Search failed. Try again.",
  "The plan changed. Reload and try again.",
  "The plan is full.",
  "Show not found.",
  "Enter 2 to 100 characters.",
  "That show key is not valid.",
  "Too many requests. Try again later.",
  "Send JSON.",
  "Request is too large.",
]);

type Origin = "taylslate" | "podscan";
type Platform = "podcast" | "youtube";

interface SearchHit {
  key: string;
  name: string;
  platform: Platform;
  audienceSize: number;
  categories: string[];
  imageUrl: string | null;
  origin: Origin;
  inPlan: boolean;
}

type Status = "idle" | "loading" | "ready" | "error";

function knownError(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "string" || !KNOWN_ERRORS.has(error)) return null;
  return error;
}

function platformLabel(platform: Platform): string {
  return platform === "youtube" ? "YouTube" : "Podcast";
}

export default function DirectShowSearch({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("Search failed. Try again.");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [podscanAvailable, setPodscanAvailable] = useState(true);
  const [addingKey, setAddingKey] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function onQuery(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    const trimmed = value.trim();
    if (trimmed.length < 2 || trimmed.length > 100) {
      requestId.current += 1;
      setStatus("idle");
      setResults([]);
      setPodscanAvailable(true);
      return;
    }
    timer.current = setTimeout(() => {
      void runSearch(trimmed);
    }, DEBOUNCE_MS);
  }

  async function runSearch(q: string) {
    const id = ++requestId.current;
    setStatus("loading");
    try {
      const res = await fetch(
        `/api/campaigns/${encodeURIComponent(campaignId)}/show-search?q=${encodeURIComponent(q)}`
      );
      const body = await res.json().catch(() => null);
      if (id !== requestId.current) return;
      if (!res.ok) {
        setError(knownError(body) ?? "Search failed. Try again.");
        setStatus("error");
        setResults([]);
        return;
      }
      const payload = body as { results?: unknown; podscanAvailable?: unknown };
      setResults(Array.isArray(payload.results) ? payload.results.filter(isHit) : []);
      setPodscanAvailable(payload.podscanAvailable !== false);
      setStatus("ready");
    } catch {
      if (id !== requestId.current) return;
      setError("Search failed. Try again.");
      setStatus("error");
      setResults([]);
    }
  }

  async function add(key: string) {
    setAddingKey(key);
    try {
      const res = await fetch(
        `/api/campaigns/${encodeURIComponent(campaignId)}/show-search/add`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key }),
        }
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(knownError(body) ?? "Search failed. Try again.");
        setStatus("error");
        return;
      }
      setResults((prev) =>
        prev.map((row) => (row.key === key ? { ...row, inPlan: true } : row))
      );
      router.refresh();
    } catch {
      setError("Search failed. Try again.");
      setStatus("error");
    } finally {
      setAddingKey(null);
    }
  }

  return (
    <div className={`border-b border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-8 py-4`}>
      <button
        type="button"
        className={`${ghostBtnClass} ${inkText}`}
        style={radiusStyle}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Add a show by name
      </button>
      {open && (
        <div className="mt-4">
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search shows by name"
            aria-label="Search shows by name"
            className={`${hairline} w-full bg-[var(--ts-paper)] px-3 py-2 text-sm ${inkText} focus:border-[var(--ts-accent)] focus:outline-none`}
            style={radiusStyle}
          />
          {status === "loading" && (
            <p className={`mt-3 text-sm ${mutedText}`}>Searching...</p>
          )}
          {status === "error" && (
            <p className={`mt-3 text-sm ${mutedText}`}>{error}</p>
          )}
          {status === "ready" && results.length === 0 && (
            <p className={`mt-3 text-sm ${mutedText}`}>No shows match that name.</p>
          )}
          {status === "ready" && !podscanAvailable && (
            <p className={`mt-3 text-sm ${mutedText}`}>
              Podscan results are unavailable right now.
            </p>
          )}
          {status === "ready" && results.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {results.map((row) => (
                <li
                  key={row.key}
                  className={`${hairline} flex items-center gap-3 bg-[var(--ts-paper)] px-3 py-2`}
                  style={radiusStyle}
                >
                  {row.imageUrl ? (
                    <img
                      src={row.imageUrl}
                      alt=""
                      className={`h-9 w-9 border border-[var(--ts-hairline-on-paper)] object-cover`}
                      style={radiusStyle}
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm font-medium ${inkText}`}>{row.name}</div>
                    <div className={`mt-0.5 text-xs ${mutedText}`}>
                      {platformLabel(row.platform)}
                      {", "}
                      {row.audienceSize.toLocaleString("en-US")}
                      {row.origin === "podscan" ? " est." : ""}
                      {row.categories.length > 0 ? `, ${row.categories.join(", ")}` : ""}
                    </div>
                    {row.origin === "podscan" && (
                      <div className={`mt-0.5 text-[10px] ${mutedText}`}>From Podscan</div>
                    )}
                  </div>
                  <button
                    type="button"
                    className={`${ghostBtnClass} ${inkText}`}
                    style={radiusStyle}
                    disabled={row.inPlan || addingKey === row.key}
                    onClick={() => void add(row.key)}
                  >
                    {row.inPlan ? "In plan" : "Add to plan"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function isHit(value: unknown): value is SearchHit {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.key === "string" &&
    typeof row.name === "string" &&
    (row.platform === "podcast" || row.platform === "youtube") &&
    typeof row.audienceSize === "number" &&
    Array.isArray(row.categories) &&
    (row.imageUrl === null || typeof row.imageUrl === "string") &&
    (row.origin === "taylslate" || row.origin === "podscan") &&
    typeof row.inPlan === "boolean"
  );
}
