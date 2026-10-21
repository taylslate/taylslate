// Brand-private CRM. Every read and write uses the user server client,
// so row level security (brand_id = auth.uid()) scopes the rows.
// show_id is the catalog show on the deal (shows.id).
// Deal history is read-only. A deal counts when deals.brand_id is the
// brand, or deals.brand_profile_id belongs to that brand's profile.

import { createClient } from "@/lib/supabase/server";

export const CRM_NAME_MAX = 200;
export const CRM_EMAIL_MAX = 320;
export const CRM_ROLE_MAX = 80;
export const CRM_PHONE_MAX = 40;
export const CRM_NOTE_MAX = 2000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEAL_HISTORY_COLUMNS = [
  "id",
  "show_id",
  "brand_id",
  "brand_profile_id",
  "campaign_id",
  "status",
  "num_episodes",
  "placement",
  "cpm_rate",
  "total_gross",
  "flight_start",
  "flight_end",
  "created_at",
  "updated_at",
].join(", ");

export interface BrandShowContact {
  id: string;
  brand_id: string;
  show_id: string;
  name: string;
  email: string | null;
  role: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface BrandShowNote {
  id: string;
  brand_id: string;
  show_id: string;
  body: string;
  created_at: string;
}

export interface CrmDealHistory {
  id: string;
  show_id: string;
  brand_id: string;
  brand_profile_id: string | null;
  campaign_id: string | null;
  status: string;
  num_episodes: number | null;
  placement: string | null;
  cpm_rate: number | null;
  total_gross: number | null;
  flight_start: string | null;
  flight_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmShow {
  id: string;
  name: string;
}

export interface AddContactInput {
  brandId: string;
  showId: string;
  name: string;
  email?: string | null;
  role?: string | null;
  phone?: string | null;
}

export interface UpdateContactInput {
  brandId: string;
  showId: string;
  contactId: string;
  name?: string;
  email?: string | null;
  role?: string | null;
  phone?: string | null;
}

export interface DeleteContactInput {
  brandId: string;
  showId: string;
  contactId: string;
}

export interface AddNoteInput {
  brandId: string;
  showId: string;
  body: string;
}

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new Error(`${label} must be a uuid`);
  }
  return value;
}

function requireName(value: unknown): string {
  if (typeof value !== "string") throw new Error("name is required");
  const trimmed = value.trim();
  if (!trimmed) throw new Error("name is required");
  if (trimmed.length > CRM_NAME_MAX) {
    throw new Error(`name must be ${CRM_NAME_MAX} characters or fewer`);
  }
  return trimmed;
}

function optionalEmail(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error("email is not valid");
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.length > CRM_EMAIL_MAX) {
    throw new Error(`email must be ${CRM_EMAIL_MAX} characters or fewer`);
  }
  if (!EMAIL_RE.test(trimmed)) throw new Error("email is not valid");
  return trimmed;
}

function optionalShort(
  value: string | null | undefined,
  label: string,
  max: number
): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new Error(`${label} must be ${max} characters or fewer`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new Error(`${label} must be ${max} characters or fewer`);
  }
  return trimmed;
}

function requireNote(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`note must be between 1 and ${CRM_NOTE_MAX} characters`);
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > CRM_NOTE_MAX) {
    throw new Error(`note must be between 1 and ${CRM_NOTE_MAX} characters`);
  }
  return trimmed;
}

function throwIfError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toHistory(row: Record<string, unknown>): CrmDealHistory | null {
  if (typeof row.id !== "string" || typeof row.show_id !== "string") return null;
  return {
    id: row.id,
    show_id: row.show_id,
    brand_id: asString(row.brand_id) ?? "",
    brand_profile_id: asString(row.brand_profile_id),
    campaign_id: asString(row.campaign_id),
    status: asString(row.status) ?? "",
    num_episodes: asNumber(row.num_episodes),
    placement: asString(row.placement),
    cpm_rate: asNumber(row.cpm_rate),
    total_gross: asNumber(row.total_gross),
    flight_start: asString(row.flight_start),
    flight_end: asString(row.flight_end),
    created_at: asString(row.created_at) ?? "",
    updated_at: asString(row.updated_at) ?? "",
  };
}

type QueryError = { message: string } | null;

type DealRows = {
  data: Record<string, unknown>[] | null;
  error: QueryError;
};

type DealQuery = PromiseLike<DealRows> & {
  eq: (column: string, value: string) => DealQuery;
  or: (filters: string) => DealQuery;
  order: (column: string, options: { ascending: boolean }) => DealQuery;
};

function profileIdsFrom(rows: { id?: unknown }[] | null): string[] {
  const ids: string[] = [];
  for (const row of rows ?? []) {
    if (typeof row.id === "string" && UUID_RE.test(row.id)) ids.push(row.id);
  }
  return ids;
}

function ownedDeals(query: DealQuery, brandId: string, profileIds: string[]): DealQuery {
  if (profileIds.length === 0) return query.eq("brand_id", brandId);
  return query.or(
    `brand_id.eq.${brandId},brand_profile_id.in.(${profileIds.join(",")})`
  );
}

export async function listContacts(
  brandId: string,
  showId: string
): Promise<BrandShowContact[]> {
  const brand = requireUuid(brandId, "brandId");
  const show = requireUuid(showId, "showId");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brand_show_contacts")
    .select("*")
    .eq("brand_id", brand)
    .eq("show_id", show)
    .order("created_at", { ascending: true });
  throwIfError(error);
  return (data ?? []) as BrandShowContact[];
}

export async function addContact(input: AddContactInput): Promise<BrandShowContact> {
  const brandId = requireUuid(input.brandId, "brandId");
  const showId = requireUuid(input.showId, "showId");
  const name = requireName(input.name);
  const email = optionalEmail(input.email);
  const role = optionalShort(input.role, "role", CRM_ROLE_MAX);
  const phone = optionalShort(input.phone, "phone", CRM_PHONE_MAX);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brand_show_contacts")
    .insert({ brand_id: brandId, show_id: showId, name, email, role, phone })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "contact not found");
  return data as BrandShowContact;
}

export async function updateContact(input: UpdateContactInput): Promise<BrandShowContact> {
  const brandId = requireUuid(input.brandId, "brandId");
  const showId = requireUuid(input.showId, "showId");
  const contactId = requireUuid(input.contactId, "contactId");
  const patch: {
    name?: string;
    email?: string | null;
    role?: string | null;
    phone?: string | null;
  } = {};
  if (input.name !== undefined) patch.name = requireName(input.name);
  if (input.email !== undefined) patch.email = optionalEmail(input.email);
  if (input.role !== undefined) patch.role = optionalShort(input.role, "role", CRM_ROLE_MAX);
  if (input.phone !== undefined) patch.phone = optionalShort(input.phone, "phone", CRM_PHONE_MAX);
  if (Object.keys(patch).length === 0) throw new Error("nothing to update");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brand_show_contacts")
    .update(patch)
    .eq("id", contactId)
    .eq("brand_id", brandId)
    .eq("show_id", showId)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "contact not found");
  return data as BrandShowContact;
}

export async function deleteContact(input: DeleteContactInput): Promise<void> {
  const brandId = requireUuid(input.brandId, "brandId");
  const showId = requireUuid(input.showId, "showId");
  const contactId = requireUuid(input.contactId, "contactId");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brand_show_contacts")
    .delete()
    .eq("id", contactId)
    .eq("brand_id", brandId)
    .eq("show_id", showId)
    .select("id");
  throwIfError(error);
  if (!data || data.length === 0) throw new Error("contact not found");
}

export async function addNote(input: AddNoteInput): Promise<BrandShowNote> {
  const brandId = requireUuid(input.brandId, "brandId");
  const showId = requireUuid(input.showId, "showId");
  const body = requireNote(input.body);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brand_show_notes")
    .insert({ brand_id: brandId, show_id: showId, body })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "note not found");
  return data as BrandShowNote;
}

export async function listNotes(brandId: string, showId: string): Promise<BrandShowNote[]> {
  const brand = requireUuid(brandId, "brandId");
  const show = requireUuid(showId, "showId");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brand_show_notes")
    .select("*")
    .eq("brand_id", brand)
    .eq("show_id", show)
    .order("created_at", { ascending: false });
  throwIfError(error);
  return (data ?? []) as BrandShowNote[];
}

export async function listShowDealHistory(
  brandId: string,
  showId: string
): Promise<CrmDealHistory[]> {
  const brand = requireUuid(brandId, "brandId");
  const show = requireUuid(showId, "showId");
  const supabase = await createClient();
  const profiles = await supabase
    .from("brand_profiles")
    .select("id")
    .eq("user_id", brand);
  throwIfError(profiles.error);
  const profileIds = profileIdsFrom(profiles.data as { id?: unknown }[] | null);
  let query = supabase
    .from("deals")
    .select(DEAL_HISTORY_COLUMNS)
    .eq("show_id", show) as unknown as DealQuery;
  query = ownedDeals(query, brand, profileIds);
  const { data, error } = await query.order("created_at", { ascending: false });
  throwIfError(error);
  const history: CrmDealHistory[] = [];
  for (const row of data ?? []) {
    const deal = toHistory(row);
    if (deal) history.push(deal);
  }
  return history;
}

export async function listCrmShows(brandId: string): Promise<CrmShow[]> {
  const brand = requireUuid(brandId, "brandId");
  const supabase = await createClient();
  const [contacts, notes, profiles] = await Promise.all([
    supabase.from("brand_show_contacts").select("show_id").eq("brand_id", brand),
    supabase.from("brand_show_notes").select("show_id").eq("brand_id", brand),
    supabase.from("brand_profiles").select("id").eq("user_id", brand),
  ]);
  throwIfError(contacts.error);
  throwIfError(notes.error);
  throwIfError(profiles.error);

  const profileIds = profileIdsFrom(profiles.data as { id?: unknown }[] | null);

  let dealQuery = supabase.from("deals").select("show_id") as unknown as DealQuery;
  dealQuery = ownedDeals(dealQuery, brand, profileIds);
  const deals = await dealQuery;
  throwIfError(deals.error);

  const showIds = new Set<string>();
  for (const row of contacts.data ?? []) {
    const id = (row as { show_id?: unknown }).show_id;
    if (typeof id === "string") showIds.add(id);
  }
  for (const row of notes.data ?? []) {
    const id = (row as { show_id?: unknown }).show_id;
    if (typeof id === "string") showIds.add(id);
  }
  for (const row of deals.data ?? []) {
    const id = row.show_id;
    if (typeof id === "string") showIds.add(id);
  }
  if (showIds.size === 0) return [];

  const { data, error } = await supabase
    .from("shows")
    .select("id, name")
    .in("id", [...showIds])
    .order("name", { ascending: true });
  throwIfError(error);

  const shows: CrmShow[] = [];
  for (const row of data ?? []) {
    const id = (row as { id?: unknown }).id;
    const name = (row as { name?: unknown }).name;
    if (typeof id !== "string") continue;
    shows.push({ id, name: typeof name === "string" ? name : "" });
  }
  shows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return shows;
}
