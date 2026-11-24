// Migration 102. Runs in PGlite. Never uses a hosted database.
// Column SELECT is revoked for the three contact addresses.
// Campaign JSON loses only those contact keys.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  IO_READ_COLUMN_LIST,
  OUTREACH_READ_COLUMN_LIST,
  SHOW_READ_COLUMN_LIST,
} from "@/lib/shows/read-columns";

const sql = readFileSync(join(__dirname, "102_hide_show_contact_columns.sql"), "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const HIDDEN = "33333333-3333-4333-8333-333333333333";
const OPEN = "44444444-4444-4444-8444-444444444444";
const PROFILE = "55555555-5555-4555-8555-555555555555";
const BRAND = "66666666-6666-4666-8666-666666666666";
const CAMP_A = "77777777-7777-4777-8777-777777777777";
const CAMP_B = "88888888-8888-4888-8888-888888888888";
const CAMP_C = "99999999-9999-4999-8999-999999999999";
const CAMP_D = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OUTREACH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function cols(names: readonly string[], extra: string[]): string {
  return [...names, ...extra].map((name) => `${name} text`).join(",\n  ");
}

const fixture = `
create role authenticated nologin;
create role anon nologin;
create role service_role nologin bypassrls;

create schema if not exists auth;
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
$$;

create or replace function public.auth_login_email()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'email', '')
$$;

grant usage on schema auth to authenticated, service_role;
grant usage on schema public to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, service_role;
grant execute on function public.auth_login_email() to authenticated, service_role;

create table public.show_profiles (
  id uuid primary key,
  user_id uuid
);
create table public.brand_profiles (
  id uuid primary key,
  user_id uuid
);

create table public.shows (
  ${cols(SHOW_READ_COLUMN_LIST, ["contact_email"])}
);
create table public.outreaches (
  ${cols(OUTREACH_READ_COLUMN_LIST, ["sent_to_email"])}
);
create table public.insertion_orders (
  id uuid primary key default gen_random_uuid(),
  ${IO_READ_COLUMN_LIST.filter((name) => name !== "id").map((name) => `${name} text`).join(",\n  ")},
  publisher_contact_email text
);
create table public.campaigns (
  id uuid primary key,
  user_id uuid,
  scored_shows jsonb,
  recommendations jsonb,
  youtube_recommendations jsonb,
  expansion_opportunities jsonb,
  updated_at timestamptz
);

create or replace function public.touch_campaigns()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end
$$;

create trigger update_campaigns_timestamp
before update on public.campaigns
for each row execute function public.touch_campaigns();

grant select on table public.shows to authenticated;
grant select on table public.outreaches to authenticated;
grant select, insert on table public.insertion_orders to authenticated;
grant select on public.show_profiles to authenticated;
grant select on public.brand_profiles to authenticated;
grant all on public.shows, public.outreaches, public.insertion_orders, public.campaigns to service_role;

alter table public.shows enable row level security;
alter table public.outreaches enable row level security;
alter table public.insertion_orders enable row level security;

create policy "Shows readable by signed-in participants"
  on public.shows
  for select
  to authenticated
  using (
    is_discoverable = 'true'
    or (
      'show_owner' = any (string_to_array(data_sources, ','))
      and contact_email is not null
      and (select public.auth_login_email()) is not null
      and lower(btrim(contact_email)) = (select public.auth_login_email())
      and exists (
        select 1
        from public.show_profiles as owner_profile
        where owner_profile.user_id = (select auth.uid())
      )
    )
  );

create policy "Brand reads own outreach"
  on public.outreaches
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.brand_profiles as bp
      where bp.id = outreaches.brand_profile_id::uuid
        and bp.user_id = (select auth.uid())
    )
  );

create policy "IO select"
  on public.insertion_orders
  for select
  to authenticated
  using (true);

create policy "IO insert"
  on public.insertion_orders
  for insert
  to authenticated
  with check (true);
`;

function grantLists(text: string, table: string): string[][] {
  const marker = `on table public.${table} to authenticated`;
  const at = text.toLowerCase().indexOf(marker);
  if (at < 0) return [];
  const open = text.toLowerCase().lastIndexOf("grant select (", at);
  if (open < 0) return [];
  const body = text.slice(open + "grant select (".length, at).replace(/\)\s*$/, "");
  return [
    body
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  ];
}

describe("migration 102 text", () => {
  it("is named for Chris and states the column rule", () => {
    expect(sql).toContain("NOT APPLIED LIVE, CHRIS MUST NAME IT");
    expect(sql).toContain("Do not run this from the app");
    expect(sql).toContain(
      "AUTHENTICATED HAS COLUMN-LEVEL SELECT ON public.shows, public.outreaches AND public.insertion_orders. A NEW COLUMN ON ANY OF THESE TABLES IS NOT READABLE BY SIGNED-IN USERS UNTIL A MIGRATION GRANTS IT BY NAME. Never grant contact_email, sent_to_email or publisher_contact_email to authenticated or anon. Never re-grant table-level SELECT. Update lib/shows/read-columns.ts in the same PR."
    );
  });

  it("grants column select without the contact columns and does not touch policies", () => {
    expect(grantLists(statements, "shows")).toEqual([[...SHOW_READ_COLUMN_LIST]]);
    expect(grantLists(statements, "outreaches")).toEqual([[...OUTREACH_READ_COLUMN_LIST]]);
    expect(grantLists(statements, "insertion_orders")).toEqual([[...IO_READ_COLUMN_LIST]]);
    for (const table of ["shows", "outreaches", "insertion_orders"]) {
      for (const list of grantLists(statements, table)) {
        expect(list).not.toContain("contact_email");
        expect(list).not.toContain("sent_to_email");
        expect(list).not.toContain("publisher_contact_email");
      }
    }
    expect(statements).not.toMatch(/\bgrant\b[^;]*\bto\s+anon\b/i);
    expect(statements).not.toMatch(
      /grant\s+select\s+on\s+table\s+public\.(shows|outreaches|insertion_orders)\s+to\s+authenticated/i
    );
    expect(statements).not.toMatch(/\bdrop\s+policy\b/i);
    expect(statements).not.toMatch(/\bcreate\s+policy\b/i);
    expect(statements).not.toMatch(/\bsecurity\s+definer\b/i);
  });
});

describe("migration 102 on PGlite", () => {
  const db = new PGlite();
  const scoredBefore = [
    {
      contactEmail: "one@example.test",
      name: "One",
      nested: { contactEmail: "keep-me@example.test", n: 1 },
      tags: ["alpha", "beta"],
      count: 2,
      empty: null,
      note: "cafe",
    },
    { name: "Two", count: 3, flags: [false, true] },
    { contactEmail: "three@example.test", name: "Three", title: "héllo" },
    "plain",
    4,
    null,
  ];

  beforeAll(async () => {
    await db.exec(fixture);
    await db.exec(`
      insert into public.show_profiles (id, user_id) values ('${PROFILE}', '${OWNER}');
      insert into public.brand_profiles (id, user_id) values ('${BRAND}', '${OWNER}');
      insert into public.shows (id, name, contact_name, contact_method, contact_email, is_discoverable, data_sources)
      values
        ('${HIDDEN}', 'Hidden', 'Ada', 'email', 'host@example.test', 'false', 'show_owner'),
        ('${OPEN}', 'Open', 'Bea', 'email', 'open@example.test', 'true', 'podscan');
      insert into public.outreaches (
        id, brand_profile_id, show_name, sent_to_email, response_status
      ) values (
        '${OUTREACH}', '${BRAND}', 'Open', 'host@example.test', 'pending'
      );
      insert into public.campaigns (
        id, user_id, scored_shows, recommendations, youtube_recommendations,
        expansion_opportunities, updated_at
      ) values
        (
          '${CAMP_A}', '${OWNER}',
          $json$${JSON.stringify(scoredBefore)}$json$::jsonb,
          '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
          '2020-01-01T00:00:00Z'
        ),
        (
          '${CAMP_B}', '${OWNER}',
          '[]'::jsonb,
          '[{"show_id":"rec-1","contact_email":"rec@example.test","name":"Legacy","nested":{"contact_email":"stay@example.test"}}]'::jsonb,
          '[{"contact_email":"yt@example.test","title":"Video"}]'::jsonb,
          '[{"contact_email":"ex@example.test","n":1}]'::jsonb,
          '2020-01-01T00:00:00Z'
        ),
        (
          '${CAMP_C}', '${OWNER}',
          '[{"name":"Clean"}]'::jsonb,
          '[{"show_id":"rec-2","name":"Also clean"}]'::jsonb,
          '[]'::jsonb,
          '[]'::jsonb,
          '2020-01-02T00:00:00Z'
        ),
        (
          '${CAMP_D}', '${OWNER}',
          null,
          '{}'::jsonb,
          null,
          '[]'::jsonb,
          '2020-01-03T00:00:00Z'
        );
    `);
    await db.exec(sql);
  });

  afterAll(async () => {
    await db.close();
  });

  async function asRole(role: string, userId: string, email: string, statement: string) {
    const claims = JSON.stringify({ sub: userId, role, email }).replace(/'/g, "''");
    await db.exec(`select set_config('request.jwt.claims', '${claims}', false)`);
    await db.exec(`set role ${role}`);
    try {
      return await db.query<Record<string, unknown>>(statement);
    } finally {
      await db.exec("reset role");
    }
  }

  it("lets authenticated read granted columns and refuses the contact columns", async () => {
    const open = await asRole(
      "authenticated",
      OTHER,
      "other@example.test",
      `select id, name, contact_name, contact_method from public.shows where id = '${OPEN}'`
    );
    expect(open.rows).toEqual([
      { id: OPEN, name: "Open", contact_name: "Bea", contact_method: "email" },
    ]);

    await expect(
      asRole("authenticated", OTHER, "other@example.test", "select * from public.shows")
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole(
        "authenticated",
        OTHER,
        "other@example.test",
        "select contact_email from public.shows"
      )
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole(
        "authenticated",
        OTHER,
        "other@example.test",
        "select id from public.shows where contact_email = 'host@example.test'"
      )
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole(
        "authenticated",
        OTHER,
        "other@example.test",
        "select id from public.shows order by contact_email"
      )
    ).rejects.toThrow(/permission denied/i);

    const outreach = await asRole(
      "authenticated",
      OWNER,
      "host@example.test",
      `select id, show_name from public.outreaches where id = '${OUTREACH}'`
    );
    expect(outreach.rows).toEqual([{ id: OUTREACH, show_name: "Open" }]);
    await expect(
      asRole("authenticated", OWNER, "host@example.test", "select * from public.outreaches")
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole(
        "authenticated",
        OWNER,
        "host@example.test",
        "select sent_to_email from public.outreaches"
      )
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole(
        "authenticated",
        OWNER,
        "host@example.test",
        "select id from public.outreaches where sent_to_email = 'host@example.test'"
      )
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole(
        "authenticated",
        OWNER,
        "host@example.test",
        "select id from public.outreaches order by sent_to_email"
      )
    ).rejects.toThrow(/permission denied/i);

    const inserted = await asRole(
      "authenticated",
      OWNER,
      "host@example.test",
      "insert into public.insertion_orders (io_number) values ('IO-1') returning id, io_number"
    );
    expect(inserted.rows[0]?.io_number).toBe("IO-1");
    expect(typeof inserted.rows[0]?.id).toBe("string");
    await expect(
      asRole(
        "authenticated",
        OWNER,
        "host@example.test",
        "insert into public.insertion_orders (io_number) values ('IO-2') returning *"
      )
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole(
        "authenticated",
        OWNER,
        "host@example.test",
        "select * from public.insertion_orders"
      )
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole(
        "authenticated",
        OWNER,
        "host@example.test",
        "select publisher_contact_email from public.insertion_orders"
      )
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole(
        "authenticated",
        OWNER,
        "host@example.test",
        "select id from public.insertion_orders where publisher_contact_email = 'host@example.test'"
      )
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole(
        "authenticated",
        OWNER,
        "host@example.test",
        "select id from public.insertion_orders order by publisher_contact_email"
      )
    ).rejects.toThrow(/permission denied/i);
  });

  it("keeps the owner branch and hides that show from everyone else", async () => {
    const owner = await asRole(
      "authenticated",
      OWNER,
      "host@example.test",
      `select id from public.shows where id = '${HIDDEN}'`
    );
    expect(owner.rows).toEqual([{ id: HIDDEN }]);

    const other = await asRole(
      "authenticated",
      OTHER,
      "other@example.test",
      `select id from public.shows where id = '${HIDDEN}'`
    );
    expect(other.rows).toEqual([]);

    const openToOther = await asRole(
      "authenticated",
      OTHER,
      "other@example.test",
      `select id from public.shows where id = '${OPEN}'`
    );
    expect(openToOther.rows).toEqual([{ id: OPEN }]);
  });

  it("lets service_role read the addresses and gives anon nothing", async () => {
    const shows = await asRole(
      "service_role",
      OWNER,
      "host@example.test",
      `select contact_email from public.shows where id = '${HIDDEN}'`
    );
    expect(shows.rows).toEqual([{ contact_email: "host@example.test" }]);
    const outreach = await asRole(
      "service_role",
      OWNER,
      "host@example.test",
      `select sent_to_email from public.outreaches where id = '${OUTREACH}'`
    );
    expect(outreach.rows).toEqual([{ sent_to_email: "host@example.test" }]);

    await db.exec(`
      insert into public.insertion_orders (io_number, publisher_contact_email)
      values ('IO-ADMIN', 'host@example.test')
    `);
    const io = await asRole(
      "service_role",
      OWNER,
      "host@example.test",
      "select publisher_contact_email from public.insertion_orders where io_number = 'IO-ADMIN'"
    );
    expect(io.rows).toEqual([{ publisher_contact_email: "host@example.test" }]);

    await expect(
      asRole("anon", OTHER, "other@example.test", "select id from public.shows")
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("anon", OTHER, "other@example.test", "select id from public.outreaches")
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole("anon", OTHER, "other@example.test", "select id from public.insertion_orders")
    ).rejects.toThrow(/permission denied/i);
  });

  it("strips only the contact keys and leaves untouched rows alone", async () => {
    const rows = await db.query<{
      id: string;
      scored_shows: unknown;
      recommendations: unknown;
      youtube_recommendations: unknown;
      expansion_opportunities: unknown;
      updated_at: string;
    }>(`
      select id::text as id, scored_shows, recommendations, youtube_recommendations,
             expansion_opportunities, updated_at::text as updated_at
        from public.campaigns
       order by id
    `);
    const byId = new Map(rows.rows.map((row) => [row.id, row]));

    const stripped = scoredBefore.map((element) => {
      if (!element || typeof element !== "object" || Array.isArray(element)) return element;
      const copy = { ...(element as Record<string, unknown>) };
      delete copy.contactEmail;
      return copy;
    });
    expect(byId.get(CAMP_A)?.scored_shows).toEqual(stripped);
    expect(JSON.stringify(byId.get(CAMP_A)?.scored_shows)).not.toContain("one@example.test");
    expect(JSON.stringify(byId.get(CAMP_A)?.scored_shows)).toContain("keep-me@example.test");

    expect(byId.get(CAMP_B)?.recommendations).toEqual([
      {
        show_id: "rec-1",
        name: "Legacy",
        nested: { contact_email: "stay@example.test" },
      },
    ]);
    expect(byId.get(CAMP_B)?.youtube_recommendations).toEqual([{ title: "Video" }]);
    expect(byId.get(CAMP_B)?.expansion_opportunities).toEqual([{ n: 1 }]);
    expect(JSON.stringify(byId.get(CAMP_B))).not.toContain("rec@example.test");
    expect(JSON.stringify(byId.get(CAMP_B))).not.toContain("yt@example.test");
    expect(JSON.stringify(byId.get(CAMP_B))).not.toContain("ex@example.test");
    expect(JSON.stringify(byId.get(CAMP_B))).toContain("stay@example.test");

    expect(byId.get(CAMP_C)?.scored_shows).toEqual([{ name: "Clean" }]);
    expect(byId.get(CAMP_C)?.recommendations).toEqual([{ show_id: "rec-2", name: "Also clean" }]);
    expect(byId.get(CAMP_C)?.updated_at.startsWith("2020-01-02")).toBe(true);
    expect(byId.get(CAMP_D)?.scored_shows).toBeNull();
    expect(byId.get(CAMP_D)?.recommendations).toEqual({});
    expect(byId.get(CAMP_D)?.expansion_opportunities).toEqual([]);
    expect(byId.get(CAMP_D)?.updated_at.startsWith("2020-01-03")).toBe(true);

    const stamped = byId.get(CAMP_A)?.updated_at;
    expect(stamped?.startsWith("2020-01-01")).toBe(false);
    await db.exec(sql);
    const again = await db.query<{ updated_at: string }>(
      `select updated_at::text as updated_at from public.campaigns where id = '${CAMP_A}'`
    );
    expect(again.rows[0]?.updated_at).toBe(stamped);
    const clean = await db.query<{ updated_at: string }>(
      `select updated_at::text as updated_at from public.campaigns where id = '${CAMP_C}'`
    );
    expect(clean.rows[0]?.updated_at.startsWith("2020-01-02")).toBe(true);
  });
});
