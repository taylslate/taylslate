// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Fraunces: () => ({ variable: "--font-app-display", className: "font-display" }),
  Figtree: () => ({ variable: "--font-app-sans", className: "font-body" }),
}));

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { act, render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    width,
    height,
  }: {
    src: string;
    alt: string;
    width: number;
    height: number;
  }) => <img src={src} alt={alt} width={width} height={height} />,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ShowsHome } from "./shows-home";

describe("ShowsHome", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders the original shows headline and steps", () => {
    render(<ShowsHome />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Get the brief, the IO, and paid when the episode runs.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "A brand reaches out with a real offer. You review terms, countersign, deliver, and the payout follows the charge.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Review the offer" })).toBeInTheDocument();
    expect(
      screen.getByText("See the brand, the terms, and the flight before you agree."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Sign the IO" })).toBeInTheDocument();
    expect(
      screen.getByText("Countersign in place. Same document the brand signed."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Paid on delivery" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "When the episode is marked delivered, the charge runs and the payout follows.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Get started" })[0]).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: "For brands" })).toHaveAttribute("href", "/");
    expect(screen.queryByText("Make 2027 the year you win with podcast ads.")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Pricing" })).toBeNull();
    expect(document.querySelector(".brand-app")).not.toBeNull();
    const audience = screen.getByRole("group", { name: "Audience" });
    expect(audience.parentElement).toHaveClass("justify-center");
    expect(screen.getByRole("button", { name: "For shows" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "For brands" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("claps, then returns to the brand homepage", async () => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as typeof window.matchMedia;
    push.mockClear();

    render(<ShowsHome />);
    const open = screen.getByRole("button", { name: "Switch to brands" });
    expect(open.querySelector(".ts-clap-stick")).not.toBeNull();
    fireEvent.click(open);
    expect(screen.getByRole("button", { name: "Switch to brands" })).toHaveClass(
      "is-clapping",
    );
    expect(push).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(push).toHaveBeenCalledWith("/");
    expect(screen.getByRole("button", { name: "Switch to brands" })).not.toHaveClass(
      "is-clapping",
    );
  });

  it("has no em dashes in the rendered copy", () => {
    const { container } = render(<ShowsHome />);
    expect(container.textContent).not.toContain("\u2014");
  });
});
