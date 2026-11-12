// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EXPIRED_COPY, PLAN_COPY, SCOPE_LINES } from "@/lib/mcp-oauth/copy";
import { ConsentCard } from "./consent-client";

afterEach(() => {
  cleanup();
});

const NAME = "<script>alert(1)</script>";

describe("consent screen", () => {
  it("renders the client name as text and shows Allow and Deny", () => {
    const { container } = render(
      <ConsentCard
        mode="ready"
        requestId="44444444-4444-4444-8444-444444444444"
        clientName={NAME}
        redirectHost="app.example"
        scopes={["read", "write:campaigns", "write:outreach"]}
      />
    );
    expect(screen.getByRole("heading").textContent).toBe(`Connect ${NAME} to Taylslate`);
    expect(container.textContent).toContain(`${NAME} is asking to use your Taylslate account through MCP.`);
    expect(container.textContent).toContain("It will return you to app.example.");
    expect(container.textContent).toContain(SCOPE_LINES.read);
    expect(container.textContent).toContain(SCOPE_LINES["write:campaigns"]);
    expect(container.textContent).toContain(SCOPE_LINES["write:outreach"]);
    expect(container.textContent).toContain("Nothing is sent, signed, charged or paid without your approval.");
    expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deny" })).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toMatch(/<script/i);
    expect(container.innerHTML).toContain("var(--ts-paper)");
    expect(container.innerHTML).not.toMatch(/transition-|animate-/);
  });

  it("shows the expired state with no Allow button", () => {
    render(<ConsentCard mode="expired" />);
    expect(screen.getByText(EXPIRED_COPY)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows the no-API state with a billing link and no Allow button", () => {
    render(<ConsentCard mode="no_api" />);
    expect(screen.getByText(PLAN_COPY)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    expect(screen.getByRole("link", { name: "Billing" }).getAttribute("href")).toBe("/settings/billing");
  });

  it("does not render client names as HTML in the source", () => {
    const source = readFileSync(join(__dirname, "consent-client.tsx"), "utf8");
    expect(source).not.toContain("dangerouslySetInnerHTML");
    expect(source).not.toContain("@/lib/api/keys");
    expect(source).not.toContain("@/lib/mcp-oauth/consent");
  });
});
