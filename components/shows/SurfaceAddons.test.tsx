// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import SurfaceAddons from "./SurfaceAddons";
import type { SellableSurface } from "@/lib/shows/surfaces";

function surface(over: Partial<SellableSurface> = {}): SellableSurface {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    show_id: "show-1",
    type: "newsletter",
    audience_size: 4000,
    format: null,
    min_buy: 20000,
    creative_constraints: null,
    lead_time_days: 5,
    posting_owner: "creator",
    price: 450,
    notes: null,
    published: true,
    ...over,
  };
}

afterEach(cleanup);

describe("SurfaceAddons", () => {
  it("lists an add-on without turning the minimum into a cutoff", () => {
    render(<SurfaceAddons surfaces={[surface()]} />);
    expect(screen.getByTestId("surface-addons")).toBeInTheDocument();
    expect(screen.getByText("Newsletter mention")).toBeInTheDocument();
    expect(screen.getByText(/\$450/)).toBeInTheDocument();
    expect(screen.getByText(/Suggested minimum/)).toBeInTheDocument();
    expect(screen.getByText(/can still be added/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("renders nothing when the creator has not published a surface", () => {
    const { container } = render(<SurfaceAddons surfaces={[surface({ published: false })]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
