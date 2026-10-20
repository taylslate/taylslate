// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import GeographyForm from "./geography-form";

describe("GeographyForm", () => {
  beforeEach(() => {
    mockPush.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("previews country shares from pasted kit text and does not require them", async () => {
    const user = userEvent.setup();
    render(<GeographyForm initialText="" />);

    expect(screen.getByText(/skip this if you don't have a kit/i)).toBeInTheDocument();

    await user.type(
      screen.getByLabelText(/media kit text/i),
      "United States 62%{enter}Canada 8%"
    );

    expect(screen.getByTestId("geo-preview")).toHaveTextContent("US 62%");
    expect(screen.getByTestId("geo-preview")).toHaveTextContent("Canada 8%");
  });

  it("reads a text upload into the kit field", async () => {
    render(<GeographyForm initialText="" />);
    const file = new File(["Australia 12%\nUK 7%"], "kit.txt", { type: "text/plain" });
    const input = screen.getByLabelText(/or upload a text or pdf kit/i);
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByTestId("geo-preview")).toHaveTextContent("UK 7%");
    expect(screen.getByTestId("geo-preview")).toHaveTextContent("Australia 12%");
  });
});
