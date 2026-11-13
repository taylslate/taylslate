import { describe, it, expect, vi, beforeEach } from "vitest";

const { createUser, deleteUser, from } = vi.hoisted(() => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    auth: { admin: { createUser, deleteUser } },
    from,
  },
}));

import { createShowAccount, insertShowProfile } from "./login-otp-show";

let inserted: unknown[] = [];
let insertError: { message: string } | null = null;
let stored: { id: string; role: string } | null = null;
let eqCalls: Array<[string, string]> = [];
let upsertOptions: unknown[] = [];

beforeEach(() => {
  createUser.mockReset();
  deleteUser.mockReset();
  from.mockReset();
  inserted = [];
  insertError = null;
  stored = null;
  eqCalls = [];
  upsertOptions = [];
  createUser.mockResolvedValue({ data: { user: { id: "new-show" } }, error: null });
  deleteUser.mockResolvedValue({ data: {}, error: null });
  from.mockImplementation(() => ({
    upsert: vi.fn(async (row: { id: string; role: string }, opts?: unknown) => {
      inserted.push(row);
      upsertOptions.push(opts);
      if (!insertError && !stored) stored = { id: row.id, role: row.role };
      return { error: insertError };
    }),
    select: vi.fn(() => ({
      eq: vi.fn((column: string, value: string) => {
        eqCalls.push([column, value]);
        return {
          maybeSingle: vi.fn(async () => ({
            data:
              stored && column === "id" && stored.id === value ? { ...stored } : null,
            error: null,
          })),
        };
      }),
    })),
    insert: vi.fn(() => {
      throw new Error("profiles insert");
    }),
    update: vi.fn(() => {
      throw new Error("profiles update");
    }),
  }));
});

describe("insertShowProfile", () => {
  it("inserts a show profile for the user id and reads that role back", async () => {
    const result = await insertShowProfile("user-9", "new@example.com");
    expect(result).toEqual({ ok: true, role: "show" });
    expect(inserted[0]).toEqual({
      id: "user-9",
      email: "new@example.com",
      full_name: "",
      role: "show",
      tier: "free",
    });
    expect(upsertOptions[0]).toEqual({ onConflict: "id", ignoreDuplicates: true });
    expect(eqCalls).toEqual([["id", "user-9"]]);
  });

  it("leaves a row that already exists and returns its role", async () => {
    stored = { id: "user-1", role: "brand" };
    const result = await insertShowProfile("user-1", "brand@example.com");
    expect(result).toEqual({ ok: true, role: "brand" });
    expect(stored).toEqual({ id: "user-1", role: "brand" });
    expect(upsertOptions[0]).toEqual({ onConflict: "id", ignoreDuplicates: true });
    expect(eqCalls).toEqual([["id", "user-1"]]);
    expect(inserted[0]).toMatchObject({
      id: "user-1",
      role: "show",
      tier: "free",
    });
  });

  it("returns ok false without DB text when the write fails and no row is stored", async () => {
    insertError = { message: "secret-db-text" };
    const result = await insertShowProfile("user-9", "new@example.com");
    expect(result).toEqual({ ok: false });
    expect(JSON.stringify(result)).not.toContain("secret-db-text");
  });
});

describe("createShowAccount", () => {
  it("creates the auth user and a show profile with the default source", async () => {
    const result = await createShowAccount("new@example.com");
    expect(result).toEqual({ ok: true, userId: "new-show" });
    expect(createUser).toHaveBeenCalledWith({
      email: "new@example.com",
      email_confirm: true,
      user_metadata: { source: "email_code" },
    });
    expect(inserted[0]).toEqual({
      id: "new-show",
      email: "new@example.com",
      full_name: "",
      role: "show",
      tier: "free",
    });
  });

  it("labels user_metadata with the show_signup source but keeps role and tier hard-coded", async () => {
    const result = await createShowAccount("new@example.com", "show_signup");
    expect(result).toEqual({ ok: true, userId: "new-show" });
    expect(createUser).toHaveBeenCalledWith({
      email: "new@example.com",
      email_confirm: true,
      user_metadata: { source: "show_signup" },
    });
    expect(inserted[0]).toMatchObject({ role: "show", tier: "free" });
  });

  it("returns ok false without DB text when createUser fails", async () => {
    createUser.mockResolvedValue({
      data: { user: null },
      error: { message: "secret-db-text" },
    });
    const result = await createShowAccount("new@example.com", "show_signup");
    expect(result).toEqual({ ok: false });
    expect(JSON.stringify(result)).not.toContain("secret-db-text");
    expect(inserted).toHaveLength(0);
  });

  it("rolls the auth user back when the profile insert fails", async () => {
    insertError = { message: "secret-db-text" };
    const result = await createShowAccount("new@example.com");
    expect(result).toEqual({ ok: false });
    expect(JSON.stringify(result)).not.toContain("secret-db-text");
    expect(deleteUser).toHaveBeenCalledWith("new-show");
  });

  it("does not delete the auth user when a different role is already stored", async () => {
    stored = { id: "new-show", role: "brand" };
    const result = await createShowAccount("new@example.com");
    expect(result).toEqual({ ok: false });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(stored).toEqual({ id: "new-show", role: "brand" });
  });
});
