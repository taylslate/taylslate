// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import IOGeneratorForm from "./IOGeneratorForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const deal = {
  id: "deal-1",
  show_id: "show-1",
  brand_id: "brand-1",
  exclusivity_days: 90,
  rofr_days: 30,
  competitor_exclusion: [] as string[],
  guaranteed_downloads: 1000,
  placement: "mid-roll",
  is_scripted: false,
  is_personal_experience: true,
  reader_type: "host_read",
  content_type: "evergreen",
  pixel_required: false,
  gross_per_episode: 25,
  net_per_episode: 25,
  gross_cpm: 25,
  cpm_rate: 25,
  price_type: "cpm",
  num_episodes: 1,
  flight_start: "2026-05-01",
};

const show = {
  id: "show-1",
  name: "Harbor",
  platform: "podcast",
};

const brand = {
  id: "brand-1",
  email: "brand@example.test",
  full_name: "Brand",
  company_name: "Northwind",
  role: "brand",
  tier: "free",
  created_at: "",
};

const agent = {
  id: "agent-1",
  email: "host@example.test",
  full_name: "Host",
  company_name: "Harbor",
  role: "agent",
  tier: "free",
  created_at: "",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderForm(flags: { publisherContactHidden?: boolean; advertiserContactHidden?: boolean } = {}) {
  return render(
    <IOGeneratorForm
      deal={deal as never}
      show={show as never}
      brand={brand as never}
      agent={agent as never}
      agency={{ ...brand, id: "agency-1", email: "desk@example.test", company_name: "Left Field", full_name: "Alex" } as never}
      {...flags}
    />
  );
}

describe("IOGeneratorForm contact flags", () => {
  it("keeps the email inputs when the flags are absent", () => {
    renderForm();
    expect(screen.getAllByDisplayValue("brand@example.test").length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("host@example.test")).toBeTruthy();
    expect(screen.queryByText("Sent through Taylslate")).toBeNull();
  });

  it("replaces a hidden field with the read-only label and omits its key", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/io/pdf")) {
        return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 });
      }
      void init;
      return new Response(JSON.stringify({ io: null }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:fixture", revokeObjectURL: () => undefined });

    renderForm({ publisherContactHidden: true, advertiserContactHidden: true });
    expect(screen.queryByDisplayValue("brand@example.test")).toBeNull();
    expect(screen.queryByDisplayValue("host@example.test")).toBeNull();
    expect(screen.queryByDisplayValue("desk@example.test")).toBeNull();
    expect(screen.getAllByText("Sent through Taylslate").length).toBeGreaterThanOrEqual(3);

    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const save = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/io"));
    const saveBody = JSON.parse(String(save?.[1]?.body));
    expect(saveBody).not.toHaveProperty("publisher_contact_email");
    expect(saveBody).not.toHaveProperty("advertiser_contact_email");
    expect(saveBody).not.toHaveProperty("agency_contact_email");

    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/io/pdf"))).toBe(true)
    );
    const pdf = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/io/pdf"));
    const pdfBody = JSON.parse(String(pdf?.[1]?.body));
    expect(pdfBody.io).not.toHaveProperty("publisher_contact_email");
    expect(pdfBody.io).not.toHaveProperty("advertiser_contact_email");
    expect(pdfBody.io).not.toHaveProperty("agency_contact_email");

    fireEvent.click(screen.getByRole("button", { name: "Send via Email" }));
    expect(screen.getByRole("heading", { name: "Send IO via Email" })).toBeTruthy();
    expect(screen.queryByText("brand@example.test")).toBeNull();
    expect(screen.queryByText("desk@example.test")).toBeNull();
    expect(screen.queryByText("host@example.test")).toBeNull();
  });
});
