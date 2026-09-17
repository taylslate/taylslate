// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { mockReplace } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
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
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
    />
  ),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  ),
}));

import { HomeLanding } from "./home-landing";

function stubMatchMedia(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduced && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

describe("HomeLanding", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    stubMatchMedia(false);
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders brand copy and the slate mark by default", () => {
    render(<HomeLanding initialGuest="brands" />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Run creator sponsorships without an agency.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/tell us what you sell and who buys it/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Interpret the brief")).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Get started" })[0],
    ).toHaveAttribute("href", "/signup");
    expect(document.querySelector('img[src="/mark.png"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Sound off" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("renders show copy when the URL guest is shows", () => {
    render(<HomeLanding initialGuest="shows" />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Get the brief, the IO, and paid when the episode runs.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Review the offer")).toBeInTheDocument();
    expect(screen.getByText("Sign the IO")).toBeInTheDocument();
    expect(screen.getByText("Paid on delivery")).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Get started" })[0],
    ).toHaveAttribute("href", "/login");
  });

  it("claps then swaps to shows and persists ?for=shows", async () => {
    vi.useFakeTimers();
    render(<HomeLanding initialGuest="brands" />);

    fireEvent.click(screen.getByRole("button", { name: "Switch to shows" }));

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Run creator sponsorships without an agency.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to shows" })).toHaveClass(
      "is-clapping",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Get the brief, the IO, and paid when the episode runs.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Paid on delivery")).toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith("/?for=shows", { scroll: false });
  });

  it("swaps instantly when reduced motion is preferred", async () => {
    stubMatchMedia(true);
    vi.useFakeTimers();
    render(<HomeLanding initialGuest="brands" />);

    fireEvent.click(screen.getByRole("link", { name: "For shows" }));

    await vi.advanceTimersByTimeAsync(0);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Get the brief, the IO, and paid when the episode runs.",
      }),
    ).toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith("/?for=shows", { scroll: false });
  });
});
