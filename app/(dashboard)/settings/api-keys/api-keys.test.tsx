// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  browserUser: { id: "11111111-1111-4111-8111-111111111111", email: "brand@example.com" } as {
    id: string;
    email: string;
  } | null,
  browserProfile: { role: "brand", plan: "operator" } as { role: string; plan: string } | null,
  serverUser: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  serverProfile: { role: "brand", plan: "operator" } as { role: string; plan: string | null } | null,
  listKeys: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: async () => mocks.serverUser,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: mocks.serverProfile,
            error: mocks.serverProfile ? null : { code: "PGRST116" },
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: mocks.browserUser } }),
      signOut: async () => ({ error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: mocks.browserProfile, error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/api/keys", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/keys")>("@/lib/api/keys");
  return {
    ...actual,
    listKeys: (...args: unknown[]) => mocks.listKeys(...args),
  };
});

import SettingsPage from "../page";
import ApiKeysSettingsPage from "./page";
import { ApiKeysClient, type ApiKeyListItem } from "./api-keys-client";

const SECRET = `ts_live_0123456789abcdef_${"ab".repeat(32)}`;

function key(overrides: Partial<ApiKeyListItem> = {}): ApiKeyListItem {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Planner",
    prefix: "0123456789abcdef",
    scopes: ["read", "write:campaigns"],
    created_at: "2026-11-01T00:00:00.000Z",
    last_used_at: null,
    revoked_at: null,
    ...overrides,
  };
}

function restText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelector('a[href="/settings/api-keys"]')?.remove();
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

beforeEach(() => {
  mocks.browserUser = { id: "11111111-1111-4111-8111-111111111111", email: "brand@example.com" };
  mocks.browserProfile = { role: "brand", plan: "operator" };
  mocks.serverUser = { id: "11111111-1111-4111-8111-111111111111" };
  mocks.serverProfile = { role: "brand", plan: "operator" };
  mocks.listKeys.mockReset();
  mocks.listKeys.mockResolvedValue([]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ApiKeysClient", () => {
  it("shows an empty list, the real scope labels, and the agent actions link", () => {
    render(<ApiKeysClient initialKeys={[]} apiAccess />);
    expect(screen.getByRole("heading", { name: "Create a key" })).toBeInTheDocument();
    expect(screen.getByLabelText("Read shows, campaigns, deals and actions")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Propose campaigns. Each one waits for your approval.")
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Propose outreach. Each one waits for your approval. Nothing is sent.")
    ).toBeInTheDocument();
    expect(screen.getByText("No keys yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Agent actions" })).toHaveAttribute(
      "href",
      "/settings/agent-actions"
    );
    expect(screen.queryByText("campaigns:read")).not.toBeInTheDocument();
  });

  it("requires a name and a scope before calling the API", () => {
    render(<ApiKeysClient initialKeys={[]} apiAccess />);
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    expect(screen.getByText("Name is required.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Planner" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    expect(screen.getByText("Choose at least one scope.")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows the secret once, copies it, and clears it on Done", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          key: { ...key(), key_hash: "nope", secret: SECRET },
          secret: SECRET,
        }),
      }))
    );

    const view = render(<ApiKeysClient initialKeys={[]} apiAccess />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Planner  " } });
    fireEvent.click(screen.getByLabelText("Read shows, campaigns, deals and actions"));
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    const field = await screen.findByLabelText("API key");
    expect(field).toHaveValue(SECRET);
    expect(field).toHaveAttribute("readonly");
    expect(screen.getByText("Copy this key now. It will not be shown again.")).toBeInTheDocument();
    expect(screen.getByText("ts_live_0123456789abcdef")).toBeInTheDocument();
    expect(screen.getByText("Last used Never")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("key_hash");

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ name: "Planner", scopes: ["read"] });
    expect(init.cache).toBe("no-store");
    expect(String(init.body)).not.toContain(SECRET);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(setItem).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain(SECRET);

    view.unmount();
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it("asks before revoking and then marks the key revoked", async () => {
    const revoked = key({ revoked_at: "2026-11-02T00:00:00.000Z" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ key: revoked }),
      }))
    );
    render(<ApiKeysClient initialKeys={[key()]} apiAccess />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke Planner" }));
    expect(screen.getByText("Revoke this key? It stops working immediately.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Revoke Planner" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke key" }));
    await waitFor(() => expect(screen.getByText("Revoked")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Revoke Planner" })).not.toBeInTheDocument();
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/settings/api-keys/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(init.method).toBe("DELETE");
    expect(url).not.toContain(SECRET);
  });

  it("shows the Operator note without a create form and still lists keys", () => {
    render(
      <ApiKeysClient
        apiAccess={false}
        initialKeys={[
          key(),
          key({
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            name: "Old",
            revoked_at: "2026-08-01T00:00:00.000Z",
            last_used_at: "2026-07-01T00:00:00.000Z",
          }),
        ]}
      />
    );
    expect(screen.getByText(/API keys are part of the Operator plan/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Billing" })).toHaveAttribute("href", "/settings/billing");
    expect(screen.queryByRole("button", { name: "Create key" })).not.toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.getByText("Last used Never")).toBeInTheDocument();
    expect(screen.getByText("Last used Jul 1, 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke Planner" })).toBeInTheDocument();
  });
});

describe("API keys settings page", () => {
  it("redirects anonymous visitors and hides the page from show and agent", async () => {
    mocks.serverUser = null;
    await expect(ApiKeysSettingsPage()).rejects.toThrow(
      "REDIRECT:/login?next=/settings/api-keys"
    );

    mocks.serverUser = { id: "11111111-1111-4111-8111-111111111111" };
    mocks.serverProfile = { role: "show", plan: "operator" };
    await expect(ApiKeysSettingsPage()).rejects.toThrow("NOT_FOUND");
    mocks.serverProfile = { role: "agent", plan: "operator" };
    await expect(ApiKeysSettingsPage()).rejects.toThrow("NOT_FOUND");
    expect(mocks.listKeys).not.toHaveBeenCalled();
  });

  it("renders the brand's keys and the Operator note for Free", async () => {
    mocks.listKeys.mockResolvedValue([
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        brandId: "11111111-1111-4111-8111-111111111111",
        name: "Planner",
        prefix: "0123456789abcdef",
        scopes: ["read"],
        createdAt: "2026-11-01T00:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null,
        key_hash: "nope",
      },
    ]);
    render(await ApiKeysSettingsPage());
    expect(screen.getByText("Planner")).toBeInTheDocument();
    expect(screen.getByText("Last used Never")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("key_hash");

    cleanup();
    mocks.serverProfile = { role: "brand", plan: "pay_as_you_go" };
    render(await ApiKeysSettingsPage());
    expect(screen.getByText(/API keys are part of the Operator plan/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create key" })).not.toBeInTheDocument();
  });
});

describe("settings index card", () => {
  it("keeps the rest of the settings source identical aside from the card", () => {
    const source = readFileSync(join(process.cwd(), "app/(dashboard)/settings/page.tsx"), "utf8");
    const without = source.replace(
      /\n      \{role === "brand" && \(\n        <Link\n          href="\/settings\/api-keys"[\s\S]*?\n      \)\}\n/,
      ""
    );
    expect(without).not.toContain("/settings/api-keys");
    expect(createHash("sha256").update(without).digest("hex")).toBe(
      "abe29eb24a78cf5b1c43f1a9a4de469f61db6bd2bab6195c53964591f6251a3d"
    );
    expect(readFileSync(join(process.cwd(), "app/(dashboard)/settings/api-keys/api-keys-client.tsx"), "utf8"))
      .not.toMatch(/localStorage|sessionStorage|console\.log/);
  });

  it("shows the API keys card only for a brand, directly after Brand profile", async () => {
    const brand = render(<SettingsPage />);
    expect(await screen.findByRole("link", { name: /API keys/ })).toHaveAttribute(
      "href",
      "/settings/api-keys"
    );
    const hrefs = [...brand.container.querySelectorAll("a")].map((node) => node.getAttribute("href"));
    expect(hrefs.indexOf("/settings/api-keys")).toBe(hrefs.indexOf("/settings/brand-profile") + 1);
    expect(screen.getByRole("button", { name: "Generate API Key" })).toBeDisabled();
    const brandRest = restText(brand.container);
    expect(brandRest).not.toContain("Create and revoke keys");
    expect(brandRest).toContain("Brand profile");
    expect(brandRest).toContain("Generate API Key");

    cleanup();
    mocks.browserProfile = { role: "show", plan: "pay_as_you_go" };
    const show = render(<SettingsPage />);
    await screen.findByRole("link", { name: /Sellable surfaces/ });
    expect(show.container.querySelector('a[href="/settings/api-keys"]')).toBeNull();
    expect(show.container.textContent).not.toContain("Create and revoke keys");

    cleanup();
    mocks.browserProfile = { role: "agent", plan: "operator" };
    const agent = render(<SettingsPage />);
    await screen.findByRole("link", { name: /Sellable surfaces/ });
    expect(agent.container.querySelector('a[href="/settings/api-keys"]')).toBeNull();

    cleanup();
    mocks.browserProfile = { role: "agency", plan: "agency" };
    const agency = render(<SettingsPage />);
    await screen.findByDisplayValue("brand@example.com");
    expect(agency.container.querySelector('a[href="/settings/api-keys"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Generate API Key" })).toBeDisabled();
  });
});
