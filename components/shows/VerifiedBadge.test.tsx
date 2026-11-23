// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import VerifiedBadge from "./VerifiedBadge";

afterEach(cleanup);

describe("VerifiedBadge", () => {
  it("says Verified and labels the show for assistive tech", () => {
    const view = render(<VerifiedBadge />);
    const badge = screen.getByTestId("verified-badge");
    expect(badge).toHaveTextContent("Verified");
    expect(badge).toHaveAccessibleName("Verified show");
    expect(badge.className).toContain("var(--ts-hairline-on-paper)");
    expect(badge.className).toContain("var(--ts-ink-muted-on-paper)");
    expect(badge.className).toContain("var(--ts-radius)");
    expect(badge.className).not.toMatch(/animate/);
    expect(view.container.textContent).not.toContain("Claimed");
    expect(view.container.innerHTML).not.toContain("\u2014");
  });
});
