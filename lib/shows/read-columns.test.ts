import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTACT_FIELDS_HIDDEN } from "@/lib/relay/contact-visibility";
import {
  IO_READ_COLUMN_LIST,
  OUTREACH_READ_COLUMN_LIST,
  SHOW_READ_COLUMN_LIST,
} from "./read-columns";

const sql = readFileSync(
  join(__dirname, "../../supabase/migrations/102_hide_show_contact_columns.sql"),
  "utf8"
);

function grantList(table: string): string[] {
  const marker = `on table public.${table} to authenticated`;
  const at = sql.toLowerCase().indexOf(marker);
  expect(at).toBeGreaterThan(0);
  const open = sql.toLowerCase().lastIndexOf("grant select (", at);
  expect(open).toBeGreaterThan(-1);
  const body = sql.slice(open + "grant select (".length, at).replace(/\)\s*$/, "");
  return body
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const withheld = ["contact_email", "sent_to_email", "publisher_contact_email"];

describe("read columns match migration 102", () => {
  it("uses the granted shows columns and nothing withheld", () => {
    expect(grantList("shows")).toEqual([...SHOW_READ_COLUMN_LIST]);
    expect(SHOW_READ_COLUMN_LIST).toHaveLength(41);
  });

  it("uses the granted outreach columns and nothing withheld", () => {
    expect(grantList("outreaches")).toEqual([...OUTREACH_READ_COLUMN_LIST]);
    expect(OUTREACH_READ_COLUMN_LIST).toHaveLength(21);
  });

  it("uses the granted insertion order columns and nothing withheld", () => {
    expect(grantList("insertion_orders")).toEqual([...IO_READ_COLUMN_LIST]);
    expect(IO_READ_COLUMN_LIST).toHaveLength(37);
  });

  it("does not list a contact column", () => {
    const lists = [
      grantList("shows"),
      grantList("outreaches"),
      grantList("insertion_orders"),
      [...SHOW_READ_COLUMN_LIST],
      [...OUTREACH_READ_COLUMN_LIST],
      [...IO_READ_COLUMN_LIST],
    ];
    for (const list of lists) {
      for (const name of withheld) expect(list).not.toContain(name);
      for (const name of CONTACT_FIELDS_HIDDEN) expect(list).not.toContain(name);
    }
  });
});
