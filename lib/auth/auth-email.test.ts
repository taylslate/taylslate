import { beforeEach, describe, expect, it, vi } from "vitest";

interface AuthUser {
  id: string;
  email: string;
}

interface ProfileRow {
  id: string;
  email: string;
  role: string;
}

const { users, profiles, listError } = vi.hoisted(() => ({
  users: [] as AuthUser[],
  profiles: [] as ProfileRow[],
  listError: { current: null as { message: string } | null },
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        listUsers: async () => {
          if (listError.current) return { data: { users: [] }, error: listError.current };
          return { data: { users }, error: null };
        },
        getUserById: async (id: string) => {
          const user = users.find((row) => row.id === id) ?? null;
          return { data: { user }, error: user ? null : { message: "missing" } };
        },
      },
    },
    from: () => {
      const filters: Record<string, string> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          filters[column] = value;
          return builder;
        },
        ilike: (column: string, value: string) => {
          filters[column] = value;
          return builder;
        },
        maybeSingle: async () => {
          if (filters.email) {
            const hit = profiles.find((row) => row.email.toLowerCase() === filters.email.toLowerCase());
            return { data: hit ?? null, error: null };
          }
          const hit = profiles.find((row) => row.id === filters.id) ?? null;
          return { data: hit, error: null };
        },
      };
      return builder;
    },
  },
}));

import { getAuthEmail, getAuthUserIdByEmail, profileByLoginEmail } from "./auth-email";

const VICTIM = "11111111-1111-4111-8111-111111111111";
const ATTACKER = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  users.length = 0;
  profiles.length = 0;
  listError.current = null;
  users.push(
    { id: VICTIM, email: "Victim@Show.test" },
    { id: ATTACKER, email: "attacker@example.test" },
  );
  profiles.push(
    { id: VICTIM, email: "victim@show.test", role: "show" },
    { id: ATTACKER, email: "victim@show.test", role: "show" },
  );
});

describe("login email directory", () => {
  it("resolves the auth user when profiles.email was set to the victim address", async () => {
    expect(await getAuthUserIdByEmail("victim@show.test")).toBe(VICTIM);
    expect(await profileByLoginEmail("Victim@Show.test")).toEqual({
      id: VICTIM,
      role: "show",
    });
    expect(await getAuthEmail(ATTACKER)).toBe("attacker@example.test");
    expect((await profileByLoginEmail("attacker@example.test"))?.id).toBe(ATTACKER);
  });

  it("does not treat a profiles.email match as the login", async () => {
    profiles[0].email = "other@show.test";
    expect(await getAuthUserIdByEmail("other@show.test")).toBeNull();
    expect(await profileByLoginEmail("other@show.test")).toBeNull();
    expect(await getAuthEmail(VICTIM)).toBe("victim@show.test");
  });

  it("fails closed when the directory read fails", async () => {
    listError.current = { message: "unavailable" };
    expect(await getAuthUserIdByEmail("victim@show.test")).toBeNull();
    expect(await profileByLoginEmail("victim@show.test")).toBeNull();
  });
});
