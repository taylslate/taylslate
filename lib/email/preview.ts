// Sample render of every Taylslate email. Used by scripts/preview-emails.ts
// and by tests that check the shared layout is on each message.
// Sample data only — this module does not send.

import type { InsertionOrder, Invoice } from "@/lib/data/types";
import { buildConversionAlertPayload } from "@/lib/alerts/conversion";
import {
  EMAIL_ADDRESS_INVOICES,
  EMAIL_ADDRESS_IO,
  EMAIL_FROM_AUTH,
  EMAIL_FROM_NOTIFICATIONS,
  EMAIL_FROM_OUTREACH,
  viaTaylslateFrom,
} from "@/lib/email/addresses";
import { renderAuthTemplates } from "@/lib/email/templates/auth";
import { renderBrandSignatureReminder } from "@/lib/email/templates/brand-signature-reminder";
import { renderCampaignOutreachEmail } from "@/lib/email/templates/campaign-outreach";
import { renderDealCancelledShow } from "@/lib/email/templates/deal-cancelled-show";
import { renderInvoiceNotice } from "@/lib/email/templates/invoice-notice";
import { renderIoAttachmentEmail } from "@/lib/email/templates/io-attachment";
import { renderIoReadyForSignature } from "@/lib/email/templates/io-ready-for-signature";
import { renderLoginMagicEmail } from "@/lib/email/templates/login-magic";
import { renderLoginOtpEmail } from "@/lib/email/templates/login-otp";
import { renderMagicLinkEmail } from "@/lib/email/templates/magic-link";
import { renderBrandNotification } from "@/lib/email/templates/outreach-response-brand";
import { renderOutreachEmail } from "@/lib/email/templates/outreach";
import { renderShowCountersignatureRequest } from "@/lib/email/templates/show-countersignature-request";

export interface EmailPreview {
  id: string;
  title: string;
  subject: string;
  from: string;
  html: string;
  text: string;
}

const SITE = "https://www.taylslate.com";
const LOGIN_URL = `${SITE}/callback?token_hash=sample&type=magiclink&next=/dashboard`;
const PITCH_URL = `${SITE}/outreach/sample-token`;
const DEAL_URL = `${SITE}/deals/sample`;
const CAMPAIGN_URL = `${SITE}/campaigns/sample`;

const invoice = {
  invoice_number: "INV-2027-0142",
  io_number: "IO-2027-0088",
  bill_to_name: "Jordan Lee",
  advertiser_name: "Aurora Sleep",
  campaign_period: "March 2027",
  due_date: "2027-04-30",
  subtotal: 1425,
  adjustments: 150,
  total_due: 1275,
  line_items: [
    {
      show_name: "The Daily Briefing",
      post_date: "2027-03-12",
      description: "Mid-roll host read",
      rate: 1425,
    },
  ],
} as Invoice;

const insertionOrder = {
  io_number: "IO-2027-0088",
  advertiser_name: "Aurora Sleep",
  advertiser_contact_name: "Jordan Lee",
  payment_terms: "Net 30 EOM",
  total_net: 1140,
  line_items: [
    {
      show_name: "The Daily Briefing",
      post_date: "2027-03-12",
      placement: "mid-roll",
      guaranteed_downloads: 40000,
      net_due: 1140,
    },
  ],
} as InsertionOrder;

function appPreviews(): EmailPreview[] {
  const login = renderLoginMagicEmail({ login_url: LOGIN_URL });
  const loginCode = renderLoginOtpEmail({ code: "482913" });
  const setup = renderMagicLinkEmail({
    to_email: "host@dailybriefing.example",
    brand_name: "Aurora Sleep",
    show_name: "The Daily Briefing",
    magic_link_url: `${SITE}/api/auth/magic?token=sample`,
  });
  const outreach = renderOutreachEmail({
    show_name: "The Daily Briefing",
    to_email: "host@dailybriefing.example",
    brand_name: "Aurora Sleep",
    brand_url: "https://aurorasleep.example",
    pitch_body: "We make a sleep mask for people who travel.\n\nA three-episode test would tell us if the audience is a fit.",
    proposed_cpm: 28.5,
    proposed_episode_count: 4,
    proposed_placement: "mid-roll",
    proposed_flight_start: "2027-03-01",
    proposed_flight_end: "2027-03-31",
    pitch_url: PITCH_URL,
  });
  const legacy = renderCampaignOutreachEmail({
    showName: "The Daily Briefing",
    body: "We would like to run a three-episode test in March.",
  });
  const accepted = renderBrandNotification({
    brand_name: "Aurora Sleep",
    show_name: "The Daily Briefing",
    campaign_name: "Spring test",
    status: "accepted",
    campaign_url: CAMPAIGN_URL,
    proposed_cpm: 28.5,
  });
  const countered = renderBrandNotification({
    brand_name: "Aurora Sleep",
    show_name: "The Daily Briefing",
    campaign_name: "Spring test",
    status: "countered",
    campaign_url: CAMPAIGN_URL,
    proposed_cpm: 28.5,
    counter_cpm: 32,
    counter_message: "We can do four episodes at $32.",
  });
  const declined = renderBrandNotification({
    brand_name: "Aurora Sleep",
    show_name: "The Daily Briefing",
    campaign_name: "Spring test",
    status: "declined",
    campaign_url: CAMPAIGN_URL,
    proposed_cpm: 28.5,
    decline_reason: "The category is too close to a current sponsor.",
  });
  const ioReady = renderIoReadyForSignature({
    brand_name: "Aurora Sleep",
    show_name: "The Daily Briefing",
    agreed_cpm: 28.5,
    agreed_episode_count: 4,
    deal_url: DEAL_URL,
  });
  const reminder = renderBrandSignatureReminder({
    brand_name: "Aurora Sleep",
    show_name: "The Daily Briefing",
    agreed_cpm: 28.5,
    agreed_episode_count: 4,
    deal_url: DEAL_URL,
    days_waiting: 3,
  });
  const countersign = renderShowCountersignatureRequest({
    brand_name: "Aurora Sleep",
    show_name: "The Daily Briefing",
    agreed_cpm: 28.5,
    agreed_episode_count: 4,
  });
  const cancelled = renderDealCancelledShow({
    brand_name: "Aurora Sleep",
    show_name: "The Daily Briefing",
    cause: "brand_cancelled",
    reason: "Budget moved to next quarter.",
  });
  const timedOut = renderDealCancelledShow({
    brand_name: "Aurora Sleep",
    show_name: "The Daily Briefing",
    cause: "timeout",
  });
  const invoiceMail = renderInvoiceNotice(invoice, "Aurora Sleep");
  const ioMail = renderIoAttachmentEmail(insertionOrder, "Host");
  const conversion = buildConversionAlertPayload({
    profile: {
      id: "brand_1",
      company_name: "Aurora Sleep",
      email: "jordan@aurorasleep.example",
    },
    monthlyAvgCents: 2_500_000,
  });

  return [
    { id: "login-magic", title: "Login magic link", from: EMAIL_FROM_AUTH, ...login },
    { id: "login-otp", title: "Show sign-in code", from: EMAIL_FROM_AUTH, ...loginCode },
    { id: "show-setup-magic", title: "Show setup magic link", from: EMAIL_FROM_AUTH, ...setup },
    {
      id: "outreach-pitch",
      title: "Outreach pitch",
      subject: outreach.subject,
      from: outreach.from,
      html: outreach.html,
      text: outreach.text,
    },
    { id: "legacy-campaign-outreach", title: "Legacy campaign outreach", from: EMAIL_FROM_OUTREACH, subject: "(set by the brand)", ...legacy },
    { id: "brand-accepted", title: "Show accepted", from: EMAIL_FROM_NOTIFICATIONS, ...accepted },
    { id: "brand-counter", title: "Show countered", from: EMAIL_FROM_NOTIFICATIONS, ...countered },
    { id: "brand-declined", title: "Show declined", from: EMAIL_FROM_NOTIFICATIONS, ...declined },
    { id: "io-ready", title: "IO ready to sign", from: EMAIL_FROM_NOTIFICATIONS, ...ioReady },
    { id: "brand-reminder", title: "Brand signature reminder", from: EMAIL_FROM_NOTIFICATIONS, ...reminder },
    { id: "show-countersign", title: "Show countersign notice", from: EMAIL_FROM_NOTIFICATIONS, ...countersign },
    { id: "deal-cancelled-brand", title: "Deal cancelled by brand", from: EMAIL_FROM_NOTIFICATIONS, ...cancelled },
    { id: "deal-cancelled-timeout", title: "Deal closed on timeout", from: EMAIL_FROM_NOTIFICATIONS, ...timedOut },
    {
      id: "invoice",
      title: "Invoice with PDF",
      from: viaTaylslateFrom("Aurora Sleep", EMAIL_ADDRESS_INVOICES),
      subject: "Invoice INV-2027-0142 for Aurora Sleep, March 2027",
      ...invoiceMail,
    },
    {
      id: "io-pdf",
      title: "Insertion order PDF",
      from: viaTaylslateFrom("Host", EMAIL_ADDRESS_IO),
      subject: "Insertion order IO-2027-0088 for Aurora Sleep and The Daily Briefing",
      ...ioMail,
    },
    { id: "conversion-alert", title: "Operator conversion alert", from: EMAIL_FROM_NOTIFICATIONS, ...conversion },
  ];
}

export function renderEmailPreviews(): EmailPreview[] {
  const app = appPreviews();
  const auth = renderAuthTemplates().map((template) => ({
    id: `auth-${template.id}`,
    title: template.id,
    subject: template.subject,
    from: "Taylslate (Supabase Auth SMTP)",
    html: template.html,
    text: template.text,
  }));
  return [...app, ...auth];
}
