// Input checks for CRM routes. Limits match lib/crm/store.ts.
// A brandId on the body is never read here.

import { NextResponse } from "next/server";
import {
  CRM_EMAIL_MAX,
  CRM_NAME_MAX,
  CRM_NOTE_MAX,
  CRM_PHONE_MAX,
  CRM_ROLE_MAX,
} from "@/lib/crm/store";
import { jsonError } from "./http";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Parsed<T> = { ok: true; value: T } | { ok: false; response: NextResponse };

export function parseShowId(showId: string): Parsed<string> {
  if (!UUID_RE.test(showId)) return { ok: false, response: jsonError("Show id must be a uuid.", 400) };
  return { ok: true, value: showId };
}

export function parseContactId(contactId: string): Parsed<string> {
  if (!UUID_RE.test(contactId)) {
    return { ok: false, response: jsonError("Contact id must be a uuid.", 400) };
  }
  return { ok: true, value: contactId };
}

function parseName(value: unknown): Parsed<string> {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, response: jsonError("Name is required.", 400) };
  }
  const trimmed = value.trim();
  if (trimmed.length > CRM_NAME_MAX) {
    return {
      ok: false,
      response: jsonError(`Name must be ${CRM_NAME_MAX} characters or fewer.`, 400),
    };
  }
  return { ok: true, value: trimmed };
}

function parseEmail(value: unknown): Parsed<string | null> {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, response: jsonError("Email is not valid.", 400) };
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > CRM_EMAIL_MAX) {
    return {
      ok: false,
      response: jsonError(`Email must be ${CRM_EMAIL_MAX} characters or fewer.`, 400),
    };
  }
  if (!EMAIL_RE.test(trimmed)) return { ok: false, response: jsonError("Email is not valid.", 400) };
  return { ok: true, value: trimmed };
}

function parseShort(value: unknown, label: string, max: number): Parsed<string | null> {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== "string") {
    return { ok: false, response: jsonError(`${label} must be ${max} characters or fewer.`, 400) };
  }
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > max) {
    return { ok: false, response: jsonError(`${label} must be ${max} characters or fewer.`, 400) };
  }
  return { ok: true, value: trimmed };
}

export interface ContactWrite {
  name: string;
  email: string | null;
  role: string | null;
  phone: string | null;
}

export function parseAddContact(body: Record<string, unknown>): Parsed<ContactWrite> {
  const name = parseName(body.name);
  if (!name.ok) return name;
  const email = parseEmail(body.email);
  if (!email.ok) return email;
  const role = parseShort(body.role, "Role", CRM_ROLE_MAX);
  if (!role.ok) return role;
  const phone = parseShort(body.phone, "Phone", CRM_PHONE_MAX);
  if (!phone.ok) return phone;
  return {
    ok: true,
    value: { name: name.value, email: email.value, role: role.value, phone: phone.value },
  };
}

export interface ContactPatch {
  name?: string;
  email?: string | null;
  role?: string | null;
  phone?: string | null;
}

export function parseUpdateContact(body: Record<string, unknown>): Parsed<ContactPatch> {
  const patch: ContactPatch = {};
  if ("name" in body) {
    const name = parseName(body.name);
    if (!name.ok) return name;
    patch.name = name.value;
  }
  if ("email" in body) {
    const email = parseEmail(body.email);
    if (!email.ok) return email;
    patch.email = email.value;
  }
  if ("role" in body) {
    const role = parseShort(body.role, "Role", CRM_ROLE_MAX);
    if (!role.ok) return role;
    patch.role = role.value;
  }
  if ("phone" in body) {
    const phone = parseShort(body.phone, "Phone", CRM_PHONE_MAX);
    if (!phone.ok) return phone;
    patch.phone = phone.value;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, response: jsonError("Nothing to update.", 400) };
  }
  return { ok: true, value: patch };
}

export function parseNote(body: Record<string, unknown>): Parsed<string> {
  if (typeof body.body !== "string") {
    return {
      ok: false,
      response: jsonError(`Note must be between 1 and ${CRM_NOTE_MAX} characters.`, 400),
    };
  }
  const trimmed = body.body.trim();
  if (trimmed.length < 1 || trimmed.length > CRM_NOTE_MAX) {
    return {
      ok: false,
      response: jsonError(`Note must be between 1 and ${CRM_NOTE_MAX} characters.`, 400),
    };
  }
  return { ok: true, value: trimmed };
}
