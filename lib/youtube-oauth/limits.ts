// Rate limits for the YouTube OAuth routes. Buckets live here so
// lib/security/rate-limit.ts stays shared. Fail closed.

import {
  enforceRules,
  rateLimitClientIp,
  type RateLimitRule,
} from "@/lib/security/rate-limit";
import type { NextResponse } from "next/server";

export const YOUTUBE_USER_MAX = 10;
export const YOUTUBE_USER_WINDOW_SEC = 60 * 60;
export const YOUTUBE_IP_MAX = 30;
export const YOUTUBE_IP_WINDOW_SEC = 60 * 60;

type HeaderSource = { headers: Headers };

function rules(bucket: string, userId: string, headers: Headers): RateLimitRule[] {
  return [
    {
      bucket: `${bucket}_user`,
      key: userId.trim(),
      max: YOUTUBE_USER_MAX,
      windowSeconds: YOUTUBE_USER_WINDOW_SEC,
    },
    {
      bucket: `${bucket}_ip`,
      key: rateLimitClientIp(headers),
      max: YOUTUBE_IP_MAX,
      windowSeconds: YOUTUBE_IP_WINDOW_SEC,
    },
  ];
}

function enforce(bucket: string, userId: string, request: HeaderSource): Promise<NextResponse | null> {
  return enforceRules({
    failureMode: "closed",
    rules: rules(bucket, userId, request.headers),
  });
}

export function enforceYoutubeConnect(userId: string, request: HeaderSource): Promise<NextResponse | null> {
  return enforce("youtube_connect", userId, request);
}

export function enforceYoutubeCallback(userId: string, request: HeaderSource): Promise<NextResponse | null> {
  return enforce("youtube_callback", userId, request);
}

export function enforceYoutubeDisconnect(userId: string, request: HeaderSource): Promise<NextResponse | null> {
  return enforce("youtube_disconnect", userId, request);
}

export function enforceYoutubeStatus(userId: string, request: HeaderSource): Promise<NextResponse | null> {
  return enforce("youtube_status", userId, request);
}
