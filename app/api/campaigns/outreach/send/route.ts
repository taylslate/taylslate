import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { EMAIL_FROM_OUTREACH } from "@/lib/email/addresses";
import { renderCampaignOutreachEmail } from "@/lib/email/templates/campaign-outreach";

interface OutreachEmailInput {
  show_id: string;
  show_name: string;
  contact_email: string;
  subject: string;
  body: string;
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

  let body: { drafts: OutreachEmailInput[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.drafts || !Array.isArray(body.drafts) || body.drafts.length === 0) {
    return NextResponse.json({ error: "No email drafts provided" }, { status: 400 });
  }

  const resend = new Resend(apiKey);
  const results: Array<{ show_id: string; success: boolean; to?: string; error?: string }> = [];

  for (const draft of body.drafts) {
    if (!draft.contact_email || !draft.subject || !draft.body) {
      results.push({ show_id: draft.show_id, success: false, error: "Missing required fields" });
      continue;
    }

    const rendered = renderCampaignOutreachEmail({
      showName: draft.show_name,
      body: draft.body,
    });

    try {
      const { error } = await resend.emails.send({
        from: EMAIL_FROM_OUTREACH,
        to: draft.contact_email,
        subject: draft.subject,
        html: rendered.html,
        text: rendered.text,
      });

      if (error) {
        results.push({ show_id: draft.show_id, success: false, to: draft.contact_email, error: error.message });
      } else {
        results.push({ show_id: draft.show_id, success: true, to: draft.contact_email });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      results.push({ show_id: draft.show_id, success: false, to: draft.contact_email, error: message });
    }
  }

  return NextResponse.json({ results });
}
