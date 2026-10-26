import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { EMAIL_FROM_OUTREACH } from "@/lib/email/addresses";
import { resolveManagedDelivery } from "@/lib/email/send";
import { renderCampaignOutreachEmail } from "@/lib/email/templates/campaign-outreach";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { enforceOutreachSend } from "@/lib/security/rate-limit";

interface OutreachEmailInput {
  show_id: string;
  show_name: string;
  contact_email: string;
  subject: string;
  body: string;
}

const MAX_DRAFTS = 50;
const MAX_SUBJECT_CHARS = 200;
const MAX_BODY_BYTES = 10 * 1024;
const MAX_REQUEST_BYTES = 512 * 1024;

interface CampaignContacts {
  id: string;
  user_id: string;
  recommendations: unknown;
  youtube_recommendations: unknown;
  expansion_opportunities: unknown;
}

function contactKey(email: string): string {
  return email.trim().toLowerCase();
}

function addContact(allowed: Map<string, Set<string>>, showId: unknown, email: unknown) {
  if (typeof showId !== "string" || typeof email !== "string") return;
  const id = showId.trim();
  const key = contactKey(email);
  if (!id || !key) return;
  const existing = allowed.get(id);
  if (existing) {
    existing.add(key);
    return;
  }
  allowed.set(id, new Set([key]));
}

function contactsFromList(allowed: Map<string, Set<string>>, value: unknown) {
  if (!Array.isArray(value)) return;
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const show = row as { show_id?: unknown; contact_email?: unknown };
    addContact(allowed, show.show_id, show.contact_email);
  }
}

function allowedContacts(campaign: CampaignContacts): Map<string, Set<string>> {
  const allowed = new Map<string, Set<string>>();
  contactsFromList(allowed, campaign.recommendations);
  contactsFromList(allowed, campaign.youtube_recommendations);
  contactsFromList(allowed, campaign.expansion_opportunities);
  return allowed;
}

function draftIsAllowed(allowed: Map<string, Set<string>>, draft: OutreachEmailInput): boolean {
  if (typeof draft.show_id !== "string" || typeof draft.contact_email !== "string") return false;
  const emails = allowed.get(draft.show_id.trim());
  if (!emails) return false;
  return emails.has(contactKey(draft.contact_email));
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Email sending is not configured. Add a RESEND_API_KEY environment variable.",
        code: "NO_API_KEY",
      },
      { status: 503 }
    );
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await enforceOutreachSend(user.id);
  if (limited) return limited;

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
  }

  let body: { campaign_id?: unknown; drafts?: OutreachEmailInput[] };
  try {
    body = JSON.parse(raw) as { campaign_id?: unknown; drafts?: OutreachEmailInput[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.campaign_id !== "string" || body.campaign_id.trim() === "") {
    return NextResponse.json({ error: "campaign_id is required" }, { status: 400 });
  }

  if (!body.drafts || !Array.isArray(body.drafts) || body.drafts.length === 0) {
    return NextResponse.json({ error: "No email drafts provided" }, { status: 400 });
  }

  if (body.drafts.length > MAX_DRAFTS) {
    return NextResponse.json({ error: "Too many drafts" }, { status: 400 });
  }

  for (const draft of body.drafts) {
    if (draft && typeof draft.subject === "string" && draft.subject.length > MAX_SUBJECT_CHARS) {
      return NextResponse.json({ error: "Subject is too long" }, { status: 400 });
    }
    if (draft && typeof draft.body === "string" && Buffer.byteLength(draft.body, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Body is too large" }, { status: 400 });
    }
  }

  const { data: campaign, error: campaignError } = await supabaseAdmin
    .from("campaigns")
    .select("id, user_id, recommendations, youtube_recommendations, expansion_opportunities")
    .eq("id", body.campaign_id)
    .maybeSingle<CampaignContacts>();

  if (campaignError) {
    return NextResponse.json({ error: "Failed to load campaign" }, { status: 500 });
  }
  if (!campaign || campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allowed = allowedContacts(campaign);
  const resend = new Resend(apiKey);
  const results: Array<{ show_id: string; success: boolean; to?: string; error?: string }> = [];

  for (const draft of body.drafts) {
    if (!draft.contact_email || !draft.subject || !draft.body) {
      results.push({ show_id: draft.show_id, success: false, error: "Missing required fields" });
      continue;
    }

    if (!draftIsAllowed(allowed, draft)) {
      results.push({
        show_id: draft.show_id,
        success: false,
        error: "Recipient is not a contact on this campaign.",
      });
      continue;
    }

    const rendered = renderCampaignOutreachEmail({
      showName: draft.show_name,
      body: draft.body,
    });

    const delivery = await resolveManagedDelivery({
      to: draft.contact_email,
      subject: draft.subject,
    });
    if (!delivery.ok) {
      results.push({
        show_id: draft.show_id,
        success: false,
        to: draft.contact_email,
        error:
          "This show is managed and MANAGED_ACCOUNT_INBOX is not set, so the email was not sent.",
      });
      continue;
    }

    try {
      const { error } = await resend.emails.send({
        from: EMAIL_FROM_OUTREACH,
        to: delivery.to,
        subject: delivery.subject,
        html: rendered.html,
        text: rendered.text,
      });

      if (error) {
        results.push({ show_id: draft.show_id, success: false, to: delivery.to, error: error.message });
      } else {
        results.push({ show_id: draft.show_id, success: true, to: delivery.to });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      results.push({ show_id: draft.show_id, success: false, to: delivery.to, error: message });
    }
  }

  return NextResponse.json({ results });
}
