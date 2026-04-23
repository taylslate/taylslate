// One-show pitch body generator.
// Wave 11 uses this when the brand opens the composer, before they can edit.
// Older bulk outreach (lib/prompts/outreach-email.ts) is still wired into the
// legacy campaign-detail flow — keeping both until that view is retired.

import Anthropic from "@anthropic-ai/sdk";
import type { BrandProfile } from "@/lib/data/types";

export interface PitchDraftInput {
  brand_name: string;
  brand_url?: string | null;
  brand_profile?: BrandProfile | null;

  show_name: string;
  show_categories?: string[];
  show_audience_size?: number | null;
  show_existing_sponsors?: string[];

  proposed_cpm: number;
  proposed_episode_count: number;
  proposed_placement: string;
}

export const PITCH_SYSTEM_PROMPT = `You write a single sponsorship outreach email body from a brand to a podcast/YouTube show. The brand's name appears as the email "from" — never start with "Hi, I'm [Brand]". Open with the show.

Voice: a real media buyer. Conversational, direct, respectful of the creator's time. Boringly professional — the tone of a real agency outreach, not marketing copy.

Structure (4-6 sentences, no bullet points):
1. Greeting + one specific reason this show fits — reference categories, audience, or existing sponsor overlap.
2. One sentence on what the brand does and why it lines up with the show's audience.
3. Brief framing of the proposed run — placement, episode count, flight window. Keep it casual ("we're thinking 3 mid-roll spots over a month").
4. Soft CTA — "would love to find time" or "happy to share more on a call".

Hard rules:
- Do NOT include the CPM, dollar amounts, or budget figures in the body. The proposed terms are surfaced separately as a structured block.
- Do NOT use the word "synergy" or marketing buzzwords.
- Do NOT use exclamation points.
- No greeting like "Hi [Show]". Use the show's name naturally.
- No sign-off — the brand name is in the from-field.

Return ONLY the email body as plain text. No JSON, no markdown, no preamble.`;

export function buildPitchUserPrompt(input: PitchDraftInput): string {
  const lines: string[] = [];
  lines.push(`Brand: ${input.brand_name}`);
  if (input.brand_url) lines.push(`Brand URL: ${input.brand_url}`);
  if (input.brand_profile?.brand_identity) {
    lines.push(`Brand identity: ${input.brand_profile.brand_identity}`);
  }
  if (input.brand_profile?.target_customer) {
    lines.push(`Target customer: ${input.brand_profile.target_customer}`);
  }
  if (input.brand_profile?.campaign_goals?.length) {
    lines.push(`Goals: ${input.brand_profile.campaign_goals.join(", ")}`);
  }

  lines.push("");
  lines.push(`Show: ${input.show_name}`);
  if (input.show_categories?.length) {
    lines.push(`Show categories: ${input.show_categories.join(", ")}`);
  }
  if (input.show_audience_size) {
    lines.push(`Show audience: ~${(input.show_audience_size / 1000).toFixed(0)}K downloads/ep`);
  }
  if (input.show_existing_sponsors?.length) {
    lines.push(`Recent sponsors of the show: ${input.show_existing_sponsors.join(", ")}`);
  }

  lines.push("");
  lines.push(`Proposed run: ${input.proposed_episode_count} ${input.proposed_placement} spot${
    input.proposed_episode_count === 1 ? "" : "s"
  }.`);
  lines.push("");
  lines.push("Write the email body now. Plain text only.");

  return lines.join("\n");
}

export async function generatePitchBody(input: PitchDraftInput): Promise<string> {
  let client: Anthropic;
  try {
    client = new Anthropic();
  } catch {
    return fallbackPitch(input);
  }
  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      system: PITCH_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildPitchUserPrompt(input) }],
    });
    const text = message.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n")
      .trim();
    return text || fallbackPitch(input);
  } catch (err) {
    console.error("[generatePitchBody] failed:", err instanceof Error ? err.message : err);
    return fallbackPitch(input);
  }
}

/** Generic, safe fallback when Claude is unavailable — brand can edit before sending. */
export function fallbackPitch(input: PitchDraftInput): string {
  const audienceLine = input.show_categories?.length
    ? `Your audience around ${input.show_categories.slice(0, 2).join(" and ")} lines up with what we're building.`
    : `Your audience feels like a strong match for what we're building.`;

  return [
    `${input.show_name} keeps coming up as a fit for what we're working on, so wanted to reach out directly.`,
    `${audienceLine} ${
      input.brand_profile?.brand_identity ?? "We help people get value out of a category we think your listeners care about."
    }`,
    `We're thinking ${input.proposed_episode_count} ${input.proposed_placement} spot${
      input.proposed_episode_count === 1 ? "" : "s"
    } — happy to flex on the format.`,
    `Would love to find time to talk through it. Open to a quick call this week or next?`,
  ].join("\n\n");
}
