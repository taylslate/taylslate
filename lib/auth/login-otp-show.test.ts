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

import { createShowAccount } from "./login-otp-show";

let inserted: unknown[] = [];
let insertError: { message: string } | null = null;

beforeEach(() => {
  createUser.mockReset();
  deleteUser.mockReset();
  from.mockReset();
  inserted = [];
  insertError = null;
  createUser.mockResolvedValue({ data: { user: { id: "new-show" } }, error: null });
  deleteUser.mockResolvedValue({ data: {}, error: null });
  from.mockImplementation(() => ({
    insert: vi.fn(async (row: unknown) => {
      inserted.push(row);
      return { error: insertError };
    }),
  }));
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
});
