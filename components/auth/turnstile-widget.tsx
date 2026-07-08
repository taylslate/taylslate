"use client";

import Script from "next/script";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { TURNSTILE_SITE_KEY, turnstileEnabled } from "@/lib/auth/turnstile";

// Cloudflare Turnstile client widget for the brand auth forms. Loads the
// Turnstile script and renders a managed widget in `interaction-only`
// appearance so legitimate users see minimal friction — the widget auto-issues
// a token via the callback and only surfaces UI when a challenge is required.
// It never gates submit; the parent form threads the token when present and
// falls back to a Supabase captcha error (→ reset + retry) if none was issued.
//
// Renders nothing when NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset (local dev), so
// the forms have no hard dependency on Turnstile.

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  "error-callback"?: () => void;
  "expired-callback"?: () => void;
  theme?: "auto" | "light" | "dark";
  appearance?: "always" | "execute" | "interaction-only";
  size?: "normal" | "flexible" | "compact";
}

interface TurnstileApi {
  render: (el: HTMLElement, opts: TurnstileRenderOptions) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// Imperative handle the parent form uses to reset the widget after a failed
// submit — Turnstile tokens are single-use, so a retry needs a fresh one.
export interface TurnstileHandle {
  reset: () => void;
}

interface TurnstileWidgetProps {
  // Called with a fresh token each time the widget solves a challenge.
  onVerify: (token: string) => void;
  // Called when the widget errors out (network/challenge failure).
  onError?: () => void;
  // Called when an issued token expires and must be discarded.
  onExpire?: () => void;
}

export const TurnstileWidget = forwardRef<TurnstileHandle, TurnstileWidgetProps>(
  function TurnstileWidget({ onVerify, onError, onExpire }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const widgetIdRef = useRef<string | null>(null);
    // Seed true if the script already loaded on a prior page (client-side nav),
    // since next/script won't re-fire onLoad for an already-present script.
    const [scriptReady, setScriptReady] = useState(
      () => typeof window !== "undefined" && !!window.turnstile,
    );

    // Keep the latest callbacks in a ref so the widget (rendered once) always
    // invokes current handlers without being torn down on every parent render.
    const cbRef = useRef({ onVerify, onError, onExpire });
    useEffect(() => {
      cbRef.current = { onVerify, onError, onExpire };
    });

    useImperativeHandle(
      ref,
      () => ({
        reset: () => {
          if (widgetIdRef.current !== null && window.turnstile) {
            try {
              window.turnstile.reset(widgetIdRef.current);
            } catch {
              /* widget may be gone; a fresh render will re-issue a token */
            }
          }
        },
      }),
      [],
    );

    const renderWidget = useCallback(() => {
      if (
        !scriptReady ||
        !containerRef.current ||
        !window.turnstile ||
        widgetIdRef.current !== null
      ) {
        return;
      }
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: "light",
        appearance: "interaction-only",
        callback: (token: string) => cbRef.current.onVerify(token),
        "error-callback": () => cbRef.current.onError?.(),
        "expired-callback": () => cbRef.current.onExpire?.(),
      });
    }, [scriptReady]);

    useEffect(() => {
      renderWidget();
      return () => {
        if (widgetIdRef.current !== null && window.turnstile) {
          try {
            window.turnstile.remove(widgetIdRef.current);
          } catch {
            /* best-effort teardown */
          }
          widgetIdRef.current = null;
        }
      };
    }, [renderWidget]);

    if (!turnstileEnabled()) return null;

    return (
      <>
        <Script
          src={SCRIPT_SRC}
          strategy="afterInteractive"
          onLoad={() => setScriptReady(true)}
        />
        <div ref={containerRef} />
      </>
    );
  },
);
