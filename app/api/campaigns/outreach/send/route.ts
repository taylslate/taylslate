import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAuthenticatedUser } from "@/lib/data/queries";
import { EMAIL_FROM_OUTREACH } from "@/lib/email/addresses";
import { resolveManagedDelivery } from "@/lib/email/send";
import { renderCampaignOutreachEmail } from "@/lib/email/templates/campaign-outreach";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { enforceOutreachSend } from "@/lib/security/rate-limit";
import { stripContactDetails } from "@/lib/relay/strip-contacts";
import { resolveOutreachRecipient } from "@/lib/relay/recipient";

interface OutreachEmailInput {
  show_id: string;
  show_name: string;
  contact_email?: string;
  subject: string;
  body: string;
}

const MAX_DRAFTS = 50;
const MAX_SUBJECT_CHARS = 200;
const MAX_BODY_BYTES = 10 * 1024;
const MAX_REQUEST_BYTES = 512 * 1024;

interface CampaignOwner {
  id: string;
  user_id: string;
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
    .select("id, user_id")
    .eq("id", body.campaign_id)
    .maybeSingle<CampaignOwner>();

  if (campaignError) {
    return NextResponse.json({ error: "Failed to load campaign" }, { status: 500 });
  }
  if (!campaign || campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const resend = new Resend(apiKey);
  const results: Array<{ show_id: string; success: boolean; error?: string }> = [];

  for (const draft of body.drafts) {
    if (!draft.show_id || !draft.subject || !draft.body) {
      results.push({ show_id: draft.show_id, success: false, error: "Missing required fields" });
      continue;
    }

    const recipient = await resolveOutreachRecipient({
      userId: user.id,
      campaignId: campaign.id,
      showId: draft.show_id,
    });
    if (!recipient.ok) {
      results.push({
        show_id: draft.show_id,
        success: false,
        error:
          recipient.reason === "no_contact"
            ? "This show has no contact on file yet."
            : "Recipient is not a contact on this campaign.",
      });
      continue;
    }

    const stripped = stripContactDetails(draft.body, { unlocked: false });
    const rendered = renderCampaignOutreachEmail({
      showName: draft.show_name,
      body: stripped.text,
    });

    const delivery = await resolveManagedDelivery({
      to: recipient.email,
      subject: draft.subject,
    });
    if (!delivery.ok) {
      results.push({
        show_id: draft.show_id,
        success: false,
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
        results.push({ show_id: draft.show_id, success: false, error: "Email was not sent." });
      } else {
        results.push({ show_id: draft.show_id, success: true });
      }
    } catch {
      results.push({ show_id: draft.show_id, success: false, error: "Email was not sent." });
    }
  }

  return NextResponse.json({ results });
}
