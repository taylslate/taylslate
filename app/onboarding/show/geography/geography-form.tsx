"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";
import {
  formatAudienceGeography,
  parseMediaKitGeography,
} from "@/lib/shows/media-kit-geo";

const MAX_CHARS = 20_000;

export default function GeographyForm({ initialText }: { initialText: string }) {
  const [text, setText] = useState(initialText);
  const [note, setNote] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const parsed = parseMediaKitGeography(text);
  const summary = formatAudienceGeography(parsed);

  const onFile = async (file: File | null) => {
    setNote(null);
    if (!file) return;
    if (file.size > 2_000_000) {
      setNote("That file is too large. Paste the geography section instead.");
      return;
    }
    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      const raw = await file.text();
      setText(raw.slice(0, MAX_CHARS));
      return;
    }
    setReading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/show-profile/media-kit", { method: "POST", body });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || !data.text?.trim()) {
        setNote(
          data.error ||
            "Couldn't read that PDF. Paste the geography section instead."
        );
        return;
      }
      setText(data.text.slice(0, MAX_CHARS));
    } catch {
      setNote("Couldn't read that PDF. Paste the geography section instead.");
    } finally {
      setReading(false);
    }
  };

  return (
    <OnboardingShell
      slug="geography"
      title="Where does your audience listen from?"
      subtitle="Optional. Paste the geography section of your media kit, or upload it. We read the country shares and show them to brands as guidance — a thin match is never hidden."
      onContinue={async () => ({ media_kit_text: text.slice(0, MAX_CHARS) })}
    >
      <label className="block text-xs font-medium uppercase tracking-wider text-[var(--ts-ink-muted-on-paper)]" htmlFor="media-kit-text">
        Media kit text
      </label>
      <textarea
        id="media-kit-text"
        value={text}
        onChange={(e) => {
          setNote(null);
          setText(e.target.value.slice(0, MAX_CHARS));
        }}
        rows={8}
        placeholder={"Audience geography\nUnited States 62%\nUnited Kingdom 11%\nCanada 8%\nAustralia 5%"}
        className="mt-2 w-full rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-3 text-sm text-[var(--ts-ink-on-paper)] focus:outline-none"
      />
      <label className="mt-4 block text-xs font-medium uppercase tracking-wider text-[var(--ts-ink-muted-on-paper)]" htmlFor="media-kit-file">
        Or upload a text or PDF kit
      </label>
      <input
        id="media-kit-file"
        type="file"
        accept=".txt,.csv,.md,.pdf,text/plain,application/pdf"
        disabled={reading}
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          void onFile(file);
          e.target.value = "";
        }}
        className="mt-2 block w-full text-sm text-[var(--ts-ink-on-paper)] file:mr-3 file:rounded-[var(--ts-radius)] file:border file:border-[var(--ts-hairline-on-paper)] file:bg-[var(--ts-paper)] file:px-3 file:py-2 file:text-sm file:text-[var(--ts-ink-on-paper)]"
      />
      {summary ? (
        <p className="mt-4 text-sm text-[var(--ts-ink-on-paper)]" data-testid="geo-preview">
          Read from the kit: {summary}
        </p>
      ) : text.trim() ? (
        <p className="mt-4 text-sm text-[var(--ts-ink-muted-on-paper)]">
          No country breakdown in that text yet. Include lines like “United States 62%”, or skip this step.
        </p>
      ) : (
        <p className="mt-4 text-sm text-[var(--ts-ink-muted-on-paper)]">
          Skip this if you don't have a kit handy. You can add it later.
        </p>
      )}
      {note && (
        <p className="mt-2 text-sm text-[var(--ts-accent)]" role="status">
          {note}
        </p>
      )}
    </OnboardingShell>
  );
}
