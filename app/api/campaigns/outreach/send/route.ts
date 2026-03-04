import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

interface OutreachEmailInput {
  show_id: string;
  show_name: string;
  contact_email: string;
  subject: string;
  body: string;
}

function buildEmailHtml(body: string, showName: string): string {
  // Convert plain text body to HTML paragraphs
  const htmlBody = body
    .split("\n\n")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="font-size: 14px; color: #5a6370; line-height: 1.6; margin: 0 0 12px;">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; color: #1a1f27;">
      <div style="background: #0f1b2d; padding: 24px 32px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 20px; color: #ffffff; font-weight: 600;">Sponsorship Inquiry</h1>
        <p style="margin: 6px 0 0; font-size: 13px; color: #b4beda;">To: ${showName}</p>
      </div>
      <div style="background: #ffffff; padding: 24px 32px; border: 1px solid #e2e5ea; border-top: none;">
        ${htmlBody}
      </div>
      <div style="padding: 16px 32px; font-size: 11px; color: #8b95a3; text-align: center; border: 1px solid #e2e5ea; border-top: none; border-radius: 0 0 12px 12px; background: #f7f8fa;">
        Sent via Taylslate &mdash; the infrastructure layer for creator sponsorship advertising
      </div>
    </div>`;
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

    const html = buildEmailHtml(draft.body, draft.show_name);

    try {
      const { error } = await resend.emails.send({
        from: `Taylslate <outreach@taylslate.com>`,
        to: draft.contact_email,
        subject: draft.subject,
        html,
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
