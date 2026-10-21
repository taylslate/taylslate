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

import { LaunchHome, ProofSection } from "./launch-home";
import { LAUNCH } from "@/lib/marketing/launch-copy";

describe("LaunchHome", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the launch headline, sample product shot, and signup CTA", () => {
    render(<LaunchHome />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Make 2027 the year you win with podcast ads.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/static mock of the brand dashboard/i),
    ).toBeInTheDocument();
    expect(screen.getByText("North Kitchen")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Start free" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Start free" })[0]).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(screen.getAllByRole("link", { name: "Start free" })[0].className).toContain(
      "bg-[var(--ts-accent)]",
    );
    expect(document.querySelector(".brand-app")).not.toBeNull();
    expect(document.querySelector('img[src="/mark.png"]')).not.toBeNull();
  });

  it("hides proof while every slot is a placeholder and lists pricing", () => {
    render(<LaunchHome />);

    expect(screen.queryByRole("heading", { level: 2, name: "Proof" })).toBeNull();
    expect(screen.queryByText("Placeholder")).toBeNull();
    expect(screen.queryByText(/nothing below is a customer claim/i)).toBeNull();

    expect(screen.getByRole("heading", { level: 2, name: "Pricing" })).toBeInTheDocument();
    expect(screen.queryByText(/January 2027 launch/i)).toBeNull();
    expect(screen.queryByText(/launch pricing for January 2027/i)).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Free" })).toBeInTheDocument();
    expect(screen.getByText("10% card / 7% bank")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Starter" })).toBeInTheDocument();
    expect(screen.getByText("$79")).toBeInTheDocument();
    expect(screen.getByText("8% card / 5% bank")).toBeInTheDocument();
    expect(screen.getByText("5 active campaigns")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Operator" })).toBeInTheDocument();
    expect(screen.getByText("$299")).toBeInTheDocument();
    expect(screen.getByText("6% card / 3% bank")).toBeInTheDocument();
    expect(screen.getByText("Unlimited campaigns")).toBeInTheDocument();
    expect(
      screen.getByText(/the brand pays the platform fee on top of each deal/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "For shows" })).toHaveAttribute(
      "href",
      "/for-shows",
    );
    const shows = document.getElementById("shows");
    expect(shows).not.toBeNull();
    expect(shows).toHaveTextContent("Shows are free.");
    expect(shows).toHaveTextContent("Log in");
    expect(shows).toHaveTextContent("when a brand sends an offer.");
    expect(shows?.querySelector("a")).toHaveAttribute("href", "/login");
  });

  it("renders proof once one entry is real and skips placeholder slots", () => {
    render(
      <ProofSection
        proof={{
          ...LAUNCH.proof,
          items: [
            LAUNCH.proof.items[0],
            {
              label: "Northwind",
              title: "A real quote",
              body: "We ran the test.",
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Proof" })).toBeInTheDocument();
    expect(screen.getByText("A real quote")).toBeInTheDocument();
    expect(screen.getByText("We ran the test.")).toBeInTheDocument();
    expect(screen.queryByText("Placeholder")).toBeNull();
    expect(screen.queryByText("Brand logo")).toBeNull();
  });

  it("keeps the film slate visible and claps between brands and shows", async () => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as typeof window.matchMedia;
    push.mockClear();

    render(<LaunchHome />);
    const open = screen.getByRole("button", { name: "Switch to shows" });
    expect(open.querySelector(".ts-clap-stick")).not.toBeNull();
    expect(open).not.toHaveClass("is-clapping");
    const audience = screen.getByRole("group", { name: "Audience" });
    expect(audience.parentElement).toHaveClass("justify-center");
    expect(screen.getByRole("button", { name: "For brands" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "For shows" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(open);
    expect(screen.getByRole("button", { name: "Switch to shows" })).toHaveClass(
      "is-clapping",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(push).toHaveBeenCalledWith("/for-shows");
    const slate = screen.getByRole("button", { name: "Switch to shows" });
    expect(slate).not.toHaveClass("is-clapping");
    expect(slate.querySelector(".ts-clap-stick")).not.toBeNull();
    vi.useRealTimers();
  });

  it("still shows the slate when reduced motion skips the snap", () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as typeof window.matchMedia;
    push.mockClear();

    render(<LaunchHome />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to shows" }));
    const slate = screen.getByRole("button", { name: "Switch to shows" });
    expect(slate.querySelector(".ts-clap-stick")).not.toBeNull();
    expect(slate).not.toHaveClass("is-clapping");
    expect(push).toHaveBeenCalledWith("/for-shows");
  });

  it("has no em dashes in the rendered copy", () => {
    const { container } = render(<LaunchHome />);
    expect(container.textContent).not.toContain("\u2014");
  });
});
