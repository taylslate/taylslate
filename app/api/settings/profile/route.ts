// Save the signed-in user's company name. The row key is auth.uid().

import { NextResponse } from "next/server";
import { enforceRules } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 4 * 1024;
const MAX_NAME_LENGTH = 120;
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function sameOrigin(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader) return false;
  try {
    const originHost = new URL(originHeader).host;
    const requestHost = new URL(request.url).host;
    return Boolean(originHost) && originHost === requestHost;
  } catch {
    return false;
  }
}

async function readBody(request: Request): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > MAX_BODY_BYTES) {
    return null;
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseCompanyName(
  raw: string
): { ok: true; company_name: string | null } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Invalid request" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Invalid request" };
  }
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== "company_name") {
    return { ok: false, error: "Invalid request" };
  }
  const value = (parsed as { company_name: unknown }).company_name;
  if (typeof value !== "string") return { ok: false, error: "Invalid request" };

  const trimmed = value.trim();
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { ok: false, error: "Company name must be 120 characters or fewer." };
  }
  const normalized = trimmed.replace(/\s+/g, " ").replace(CONTROL_CHARS, "").trim();
  return { ok: true, company_name: normalized.length === 0 ? null : normalized };
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  if (!sameOrigin(request)) return json({ error: "Forbidden" }, 403);

  const limited = await enforceRules({
    failureMode: "closed",
    rules: [
      {
        bucket: "settings_profile_user_hour",
        key: user.id,
        max: 30,
        windowSeconds: 3600,
      },
    ],
  });
  if (limited) return limited;

  const raw = await readBody(request);
  if (raw === null) return json({ error: "Invalid request" }, 400);
  const parsed = parseCompanyName(raw);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const { data, error } = await supabase
    .from("profiles")
    .update({ company_name: parsed.company_name })
    .eq("id", user.id)
    .select("company_name")
    .single();

  if (
    error ||
    !data ||
    (data.company_name !== null && typeof data.company_name !== "string")
  ) {
    console.error(error?.code);
    return json({ error: "Could not save. Try again." }, 500);
  }

  return json({ company_name: data.company_name });
}
