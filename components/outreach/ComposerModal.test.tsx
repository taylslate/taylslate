/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ComposerModal from "./ComposerModal";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ComposerModal", () => {
  it("shows Sent through Taylslate and posts no contact email", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/draft")) {
        return new Response(JSON.stringify({ pitch_body: "This is a long enough pitch body for the send button." }), {
          status: 200,
        });
      }
      const body = JSON.parse(String(init?.body));
      expect(body.show).not.toHaveProperty("contact_email");
      expect(JSON.stringify(body)).not.toContain("host@example.test");
      return new Response(JSON.stringify({ outreach: { id: "o1" } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ComposerModal
        campaignId="c1"
        onClose={() => {}}
        onSent={() => {}}
        show={{
          show_id: "33333333-3333-4333-8333-333333333333",
          show_name: "Daily",
          audience_size: 10000,
          estimated_cpm: 25,
        }}
      />
    );

    expect(screen.queryByLabelText(/recipient email/i)).toBeNull();
    expect(document.querySelector("input[type='email']")).toBeNull();
    expect(screen.getByText("Sent through Taylslate")).toBeTruthy();
    expect(screen.getByText("Recipient")).toBeTruthy();

    await waitFor(() => expect(screen.getByRole("button", { name: "Send outreach" })).toBeTruthy());
    const send = screen.getByRole("button", { name: "Send outreach" }) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
