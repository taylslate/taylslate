"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { tokens } from "@/lib/brand/tokens";
import {
  GUEST_COPY,
  guestHref,
  parseGuest,
  type MarketingGuest,
} from "@/lib/marketing/guest";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";
import { SlateClap } from "@/components/marketing/slate-clap";

const CLAP_MS = 300;
const SOUND_KEY = "ts-clap-sound";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readSoundPref(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

function writeSoundPref(on: boolean) {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // Private mode — keep the in-memory toggle only.
  }
}

function playClap() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const duration = 0.08;
    const buffer = ctx.createBuffer(
      1,
      Math.floor(ctx.sampleRate * duration),
      ctx.sampleRate,
    );
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      const env = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * env * env * 0.4;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1400;
    const gain = ctx.createGain();
    gain.gain.value = 0.18;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.onended = () => {
      void ctx.close();
    };
    src.start();
  } catch {
    // Sound is optional and must never block the swap.
  }
}

function GuestTextLink({
  guest,
  current,
  onSelect,
  children,
}: {
  guest: MarketingGuest;
  current: MarketingGuest;
  onSelect: (guest: MarketingGuest) => void;
  children: ReactNode;
}) {
  const active = guest === current;
  return (
    <Link
      href={guestHref(guest)}
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        event.preventDefault();
        onSelect(guest);
      }}
      className={
        active
          ? "text-[var(--ts-accent)]"
          : "text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
      }
    >
      {children}
    </Link>
  );
}

export function HomeLanding({
  initialGuest,
}: {
  initialGuest: MarketingGuest;
}) {
  const router = useRouter();
  const [guest, setGuest] = useState<MarketingGuest>(initialGuest);
  const [clapping, setClapping] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const busyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = GUEST_COPY[guest];
  const nextGuest: MarketingGuest = guest === "brands" ? "shows" : "brands";

  useEffect(() => {
    setGuest(initialGuest);
  }, [initialGuest]);

  useEffect(() => {
    setSoundOn(readSoundPref());
  }, []);

  useEffect(() => {
    const syncFromUrl = () => {
      setGuest(parseGuest(new URL(window.location.href).searchParams.get("for")));
    };
    window.addEventListener("popstate", syncFromUrl);
    return () => {
      window.removeEventListener("popstate", syncFromUrl);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  async function selectGuest(next: MarketingGuest) {
    if (next === guest || busyRef.current) return;
    busyRef.current = true;
    const reduced = prefersReducedMotion();
    if (!reduced) {
      setClapping(true);
      if (soundOn) playClap();
      await new Promise<void>((resolve) => {
        timerRef.current = setTimeout(resolve, CLAP_MS);
      });
      setClapping(false);
    }
    setGuest(next);
    router.replace(guestHref(next), { scroll: false });
    busyRef.current = false;
  }

  return (
    <MarketingChrome
      actions={
        <>
          <Link
            href="/login"
            className="text-sm text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
          >
            Log in
          </Link>
          <Link
            href={copy.ctaHref}
            className="hidden bg-[var(--ts-ink-on-paper)] px-3.5 py-1.5 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 sm:inline-flex"
            style={{ borderRadius: tokens.radius }}
          >
            Get started
          </Link>
        </>
      }
    >
      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-6 pt-16 pb-14 text-center sm:pt-20 sm:pb-16">
          <div className="mb-6 flex flex-col items-center">
            <div
              className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] sm:gap-3"
              role="group"
              aria-label="Audience"
            >
              <GuestTextLink
                guest="brands"
                current={guest}
                onSelect={selectGuest}
              >
                For brands
              </GuestTextLink>
              <SlateClap
                clapping={clapping}
                nextGuest={nextGuest}
                onToggle={() => {
                  void selectGuest(nextGuest);
                }}
              />
              <GuestTextLink
                guest="shows"
                current={guest}
                onSelect={selectGuest}
              >
                For shows
              </GuestTextLink>
            </div>
            <button
              type="button"
              aria-pressed={soundOn}
              onClick={() => {
                setSoundOn((prev) => {
                  const next = !prev;
                  writeSoundPref(next);
                  return next;
                });
              }}
              className="mt-2 text-[11px] text-[var(--ts-ink-muted-on-paper)]/70 hover:text-[var(--ts-ink-on-paper)]"
            >
              {soundOn ? "Sound on" : "Sound off"}
            </button>
          </div>

          <h1 className="text-[2.35rem] font-semibold leading-[1.12] tracking-tight sm:text-5xl">
            {copy.h1}
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-[var(--ts-ink-muted-on-paper)] sm:text-lg">
            {copy.sub}
          </p>

          <Link
            href={copy.ctaHref}
            className="mt-10 inline-flex bg-[var(--ts-ink-on-paper)] px-5 py-2.5 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90"
            style={{ borderRadius: tokens.radius }}
          >
            {copy.cta}
          </Link>
        </section>

        <section
          className="ts-band border-t border-[var(--ts-ink-on-paper)]/10"
          style={{
            backgroundColor:
              guest === "shows" ? tokens.bandShows : tokens.bandBrands,
          }}
        >
          <ol className="mx-auto grid max-w-5xl grid-cols-1 divide-y divide-[var(--ts-ink-on-paper)]/10 px-6 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {copy.steps.map((step) => (
              <li
                key={`${guest}-${step.n}`}
                className="py-8 sm:px-8 sm:py-12 first:sm:pl-0 last:sm:pr-0"
              >
                <p className="text-[11px] font-medium tracking-[0.16em] text-[var(--ts-accent)]">
                  {step.n}
                </p>
                <h2 className="mt-2 text-lg font-semibold tracking-tight">
                  {step.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </MarketingChrome>
  );
}
