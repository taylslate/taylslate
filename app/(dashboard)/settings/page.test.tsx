// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111", email: "brand@example.com" } as {
    id: string;
    email: string;
  } | null,
  profile: {
    role: "brand",
    plan: "pay_as_you_go",
    company_name: "Northwind Goods",
  } as { role: string; plan: string; company_name: string | null } | null,
  select: "",
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
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: mocks.user } }),
      signOut: async () => ({ error: null }),
    },
    from: () => ({
      select: (columns: string) => {
        mocks.select = columns;
        return {
          eq: () => ({
            single: async () => ({ data: mocks.profile, error: null }),
          }),
        };
      },
    }),
  }),
}));

import SettingsPage from "./page";

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

describe("settings company name", () => {
  beforeEach(() => {
    mocks.user = { id: "11111111-1111-4111-8111-111111111111", email: "brand@example.com" };
    mocks.profile = {
      role: "brand",
      plan: "pay_as_you_go",
      company_name: "Northwind Goods",
    };
    mocks.select = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/stripe/")) return jsonResponse({ paymentMethods: [] });
        return jsonResponse({});
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads a saved company name and keeps Save disabled until it changes", async () => {
    render(<SettingsPage />);
    const input = await screen.findByRole("textbox", { name: "Company Name" });
    expect(input).toHaveValue("Northwind Goods");
    expect(mocks.select).toBe("role, plan, company_name");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    fireEvent.change(input, { target: { value: "Northwind Goods Co" } });
    expect(save).toBeEnabled();
  });

  it("sends one PATCH and shows Saved.", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/settings/profile")) {
        if (init?.method !== "PATCH") return jsonResponse({ error: "bad method" }, false, 400);
        return jsonResponse({ company_name: "Northwind Goods Co" });
      }
      if (String(url).includes("/api/stripe/")) return jsonResponse({ paymentMethods: [] });
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SettingsPage />);
    const input = await screen.findByRole("textbox", { name: "Company Name" });
    fireEvent.change(input, { target: { value: "Northwind Goods Co" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Saved.");
    const patches = fetchMock.mock.calls.filter(
      (call) => String(call[0]).includes("/api/settings/profile")
    );
    expect(patches).toHaveLength(1);
    expect(patches[0]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ company_name: "Northwind Goods Co" }),
    });
    expect(input).toHaveValue("Northwind Goods Co");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows the route error when the save fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/settings/profile")) {
          return jsonResponse({ error: "Could not save. Try again." }, false, 500);
        }
        if (String(url).includes("/api/stripe/")) return jsonResponse({ paymentMethods: [] });
        return jsonResponse({});
      })
    );

    render(<SettingsPage />);
    const input = await screen.findByRole("textbox", { name: "Company Name" });
    fireEvent.change(input, { target: { value: "Other Co" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Could not save. Try again.")).toBeInTheDocument();
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
    expect(input).toHaveValue("Other Co");
  });

  it("saves when Enter is pressed in the field", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/settings/profile")) {
        return jsonResponse({ company_name: "Entered Co" });
      }
      return jsonResponse({ paymentMethods: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SettingsPage />);
    const input = await screen.findByRole("textbox", { name: "Company Name" });
    fireEvent.change(input, { target: { value: "Entered Co" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter((call) => String(call[0]).includes("/api/settings/profile"))
      ).toHaveLength(1);
    });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });
});
