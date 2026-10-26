"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export const SHOW_SEARCH_LIMIT = 50;
export const SHOW_SEARCH_MAX = 100;
export const SHOW_SEARCH_DEBOUNCE_MS = 300;

const SHOW_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PublicShow = {
  id: string;
  name: string;
  platform: "podcast" | "youtube";
  audienceSize: number;
  categories: string[];
};

type Status = "idle" | "loading" | "ready" | "error";

// Trim, cap the typed value, then escape LIKE wildcards so a name search
// cannot widen into a pattern. The API wraps this string in %…%.
export function sanitizeShowSearch(raw: string): string {
  return raw
    .trim()
    .slice(0, SHOW_SEARCH_MAX)
    .replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function showSearchPath(raw: string): string | null {
  const search = sanitizeShowSearch(raw);
  if (!search) return null;
  const params = new URLSearchParams({
    search,
    limit: String(SHOW_SEARCH_LIMIT),
  });
  return `/api/shows?${params.toString()}`;
}

// Keep the fields a brand already sees on a show row. Drop hidden rows and
// anything else on the catalog payload (contact, rates, sponsors).
export function toPublicShow(row: unknown): PublicShow | null {
  if (!row || typeof row !== "object") return null;
  const show = row as Record<string, unknown>;
  if (show.is_discoverable === false) return null;
  if (typeof show.id !== "string" || !SHOW_ID.test(show.id)) return null;
  if (show.platform !== "podcast" && show.platform !== "youtube") return null;
  if (typeof show.name !== "string" || show.name.trim() === "") return null;
  const audienceSize =
    typeof show.audience_size === "number" && Number.isFinite(show.audience_size)
      ? show.audience_size
      : 0;
  const categories = Array.isArray(show.categories)
    ? show.categories
        .filter((category): category is string => typeof category === "string")
        .map((category) => category.trim())
        .filter(Boolean)
    : [];
  return {
    id: show.id,
    name: show.name.trim(),
    platform: show.platform,
    audienceSize,
    categories,
  };
}

function formatAudience(show: PublicShow): string {
  const count = show.audienceSize.toLocaleString("en-US");
  return show.platform === "podcast" ? `${count} downloads` : `${count} views`;
}

export default function ShowSearchClient() {
  const [query, setQuery] = useState("");
  const [shows, setShows] = useState<PublicShow[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const path = showSearchPath(query);
    if (!path) {
      setShows([]);
      setError(null);
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStatus("loading");
      setError(null);
      fetch(path, { signal: controller.signal })
        .then(async (res) => {
          if (controller.signal.aborted) return;
          const body: unknown = await res.json().catch(() => null);
          if (controller.signal.aborted) return;
          if (!res.ok) {
            setShows([]);
            setError(
              res.status === 401
                ? "Sign in to search shows."
                : "Could not load shows."
            );
            setStatus("error");
            return;
          }
          if (!Array.isArray(body)) {
            setShows([]);
            setError("Could not load shows.");
            setStatus("error");
            return;
          }
          setShows(
            body
              .map(toPublicShow)
              .filter((row): row is PublicShow => row !== null)
              .slice(0, SHOW_SEARCH_LIMIT)
          );
          setStatus("ready");
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setShows([]);
          setError("Could not load shows.");
          setStatus("error");
        });
    }, SHOW_SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, retry]);

  return (
    <div className="w-full p-4 sm:p-8">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]">
        Shows
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--ts-ink-on-paper)]">
        Search
      </h1>
      <p className="mt-1 text-sm text-[var(--ts-ink-muted-on-paper)]">
        Find a discoverable show by name.
      </p>

      <form
        className="relative mt-6"
        role="search"
        onSubmit={(event) => event.preventDefault()}
      >
        <label htmlFor="show-search" className="sr-only">
          Search shows
        </label>
        <svg
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--ts-ink-muted-on-paper)]"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          id="show-search"
          type="search"
          value={query}
          maxLength={SHOW_SEARCH_MAX}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by show name"
          autoComplete="off"
          className="w-full rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] py-2.5 pr-4 pl-10 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none"
        />
      </form>

      <div className="mt-5" aria-live="polite">
        {status === "idle" ? (
          <p className="text-sm text-[var(--ts-ink-muted-on-paper)]">
            Type a show name.
          </p>
        ) : null}

        {status === "loading" ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--ts-ink-muted-on-paper)]">
              Searching shows.
            </p>
            <div className="animate-pulse rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-5">
              <div className="h-4 w-40 rounded-[var(--ts-radius)] bg-[var(--ts-ink-on-paper)]/10" />
              <div className="mt-2 h-3 w-64 rounded-[var(--ts-radius)] bg-[var(--ts-ink-on-paper)]/10" />
            </div>
          </div>
        ) : null}

        {status === "error" && error ? (
          <div className="rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-5 py-8 text-center">
            <p role="alert" className="text-sm text-[var(--ts-ink-on-paper)]">
              {error}
            </p>
            <button
              type="button"
              onClick={() => setRetry((count) => count + 1)}
              className="mt-4 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] px-3 py-1.5 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:border-[var(--ts-ink-on-paper)]"
            >
              Try again
            </button>
          </div>
        ) : null}

        {status === "ready" && shows.length === 0 ? (
          <p className="text-sm text-[var(--ts-ink-muted-on-paper)]">
            No shows match that search.
          </p>
        ) : null}

        {status === "ready" && shows.length > 0 ? (
          <ul className="space-y-3">
            {shows.map((show) => (
              <li key={show.id}>
                <Link
                  href={`/crm/${show.id}`}
                  className="block rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-5 hover:border-[var(--ts-ink-on-paper)]"
                >
                  <div className="flex items-center gap-2">
                    <h2 className="truncate font-semibold text-[var(--ts-ink-on-paper)]">
                      {show.name}
                    </h2>
                    <span className="shrink-0 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--ts-ink-muted-on-paper)]">
                      {show.platform}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--ts-ink-muted-on-paper)]">
                    {formatAudience(show)}
                    {show.categories.length > 0
                      ? ` · ${show.categories.slice(0, 2).join(", ")}`
                      : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
