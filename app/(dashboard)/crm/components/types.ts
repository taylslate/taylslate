export interface CrmContactView {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  phone: string | null;
}

export interface CrmNoteView {
  id: string;
  body: string;
  createdAt: string;
}

export interface CrmDealView {
  id: string;
  status: string;
  numEpisodes: number | null;
  placement: string | null;
  cpmRate: number | null;
  totalGross: number | null;
  flightStart: string | null;
  flightEnd: string | null;
}

export interface CrmShowView {
  id: string;
  name: string;
}

export function toContactView(row: {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  phone: string | null;
}): CrmContactView {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    phone: row.phone,
  };
}

export function toNoteView(row: { id: string; body: string; created_at: string }): CrmNoteView {
  return { id: row.id, body: row.body, createdAt: row.created_at };
}

export function toDealView(row: {
  id: string;
  status: string;
  num_episodes: number | null;
  placement: string | null;
  cpm_rate: number | null;
  total_gross: number | null;
  flight_start: string | null;
  flight_end: string | null;
}): CrmDealView {
  return {
    id: row.id,
    status: row.status,
    numEpisodes: row.num_episodes,
    placement: row.placement,
    cpmRate: row.cpm_rate,
    totalGross: row.total_gross,
    flightStart: row.flight_start,
    flightEnd: row.flight_end,
  };
}
