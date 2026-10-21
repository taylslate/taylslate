// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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

import { LaunchHome } from "./launch-home";

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
    expect(document.querySelector('img[src="/mark.png"]')).not.toBeNull();
  });

  it("marks proof as placeholders and lists launch pricing", () => {
    render(<LaunchHome />);

    expect(screen.getByRole("heading", { level: 2, name: "Proof" })).toBeInTheDocument();
    expect(screen.getAllByText("Placeholder")).toHaveLength(3);
    expect(screen.getByText(/nothing below is a customer claim/i)).toBeInTheDocument();

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
    expect(screen.getByText(/shows are free/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show log in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("has no em dashes in the rendered copy", () => {
    const { container } = render(<LaunchHome />);
    expect(container.textContent).not.toContain("\u2014");
  });
});
