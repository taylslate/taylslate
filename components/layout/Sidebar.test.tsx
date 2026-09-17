// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { mockReplace, mockRefresh, mockAssign } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockRefresh: vi.fn(),
  mockAssign: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, refresh: mockRefresh }),
  usePathname: () => "/dashboard",
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    style,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
  }) => (
    <a href={href} className={className} style={style}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    width,
    height,
    className,
  }: {
    src: string;
    alt: string;
    width: number;
    height: number;
    className?: string;
  }) => (
    <img src={src} alt={alt} width={width} height={height} className={className} />
  ),
}));

vi.mock("@/components/auth/SignOutButton", () => ({
  default: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <button type="button" className={className}>
      {children}
    </button>
  ),
}));

import Sidebar from "./Sidebar";

const BANNED = /--brand-blue|--brand-orange|--brand-navy|--brand-teal|--brand-blue-light/;

beforeEach(() => {
  mockReplace.mockReset();
  mockRefresh.mockReset();
  mockAssign.mockReset();
  vi.stubGlobal("fetch", vi.fn());
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign: mockAssign },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Sidebar chrome", () => {
  it("uses the slate mark, ink primary CTA, and paper tokens for a brand", () => {
    const { container } = render(<Sidebar role="brand" />);

    expect(container.querySelector('img[src="/mark.png"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "taylslate" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(container.textContent).not.toMatch(/^\s*T\s*$/m);

    const cta = screen.getByRole("link", { name: "New Campaign" });
    expect(cta).toHaveAttribute("href", "/campaigns/new");
    expect(cta.className).toContain("bg-[var(--ts-ink-on-paper)]");
    expect(cta.className).toContain("text-[var(--ts-paper)]");

    const dashboard = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboard.className).toContain("bg-[var(--ts-band-brands)]");

    expect(screen.getByRole("link", { name: "Campaigns" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Shows" })).toBeNull();
    expect(screen.getByRole("link", { name: "Upgrade" })).toHaveClass(
      "text-[var(--ts-accent)]",
    );

    expect(container.innerHTML).not.toMatch(BANNED);
    expect(container.querySelector("[class*='from-[var(--brand-blue)]']")).toBeNull();
  });

  it("keeps show-role nav and the Add Show CTA", () => {
    render(<Sidebar role="show" />);
    expect(screen.getByRole("link", { name: "Shows" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Campaigns" })).toBeNull();
    expect(screen.getByRole("link", { name: "Add Show" })).toHaveAttribute(
      "href",
      "/shows",
    );
  });

  it("keeps admin test-login and view-as switch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "/callback?token_hash=x" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <Sidebar
        role="brand"
        isAdmin
        canSwitchTo="show"
        testAccounts={[{ key: "brand1", label: "Test Brand 1" }]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Log in as Test Brand 1" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View as show" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Log in as Test Brand 1" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/test-login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ key: "brand1" }),
      }),
    );
  });
});
