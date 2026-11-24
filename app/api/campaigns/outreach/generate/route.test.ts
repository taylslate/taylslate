import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create };
  },
}));

import { POST } from "./route";

describe("POST /api/campaigns/outreach/generate", () => {
  beforeEach(() => {
    create.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify([
            { show_id: "show-1", subject: "Hello", body: "A note about the test." },
          ]),
        },
      ],
    });
  });

  it("returns drafts without contact_email", async () => {
    const res = await POST(
      new Request("http://x/api/campaigns/outreach/generate", {
        method: "POST",
        body: JSON.stringify({
          campaign: {
            name: "Spring",
            brief: { target_interests: [], keywords: [] },
            recommendations: [
              {
                show_id: "show-1",
                show_name: "Daily",
                platform: "podcast",
                contact_email: "host@example.test",
                categories: ["News"],
                audience_size: 1000,
                placement: "mid-roll",
                num_episodes: 3,
                current_sponsors: [],
              },
            ],
            youtube_recommendations: [],
          },
        }),
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drafts[0]).toEqual({
      show_id: "show-1",
      show_name: "Daily",
      platform: "podcast",
      subject: "Hello",
      body: "A note about the test.",
    });
    expect(body.drafts[0]).not.toHaveProperty("contact_email");
    expect(JSON.stringify(body)).not.toContain("host@example.test");
  });
});
