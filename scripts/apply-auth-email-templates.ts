// Push lib/email/templates/auth.ts onto the hosted Supabase project.
// Requires a Management API token with Auth Config write.
// Does not print the token, SMTP password, or service-role key.
// Does not change mailer_notifications_*_enabled or SMTP host/port/password.
//
//   SUPABASE_ACCESS_TOKEN=... npx tsx scripts/apply-auth-email-templates.ts

import { authTemplateConfigPatch } from "../lib/email/templates/auth";

const PROJECT_REF = "ldtmhafewfifdizgfrnn";
const ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;

const SECRET_KEY = /pass|secret|key|token|private/i;

function redact(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_KEY.test(key)) {
      out[key] = value ? "[set]" : "[empty]";
    } else if (typeof value === "string" && value.length > 180) {
      out[key] = `${value.slice(0, 120)}… (${value.length} chars)`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function readAuthConfig(token: string): Promise<Record<string, unknown>> {
  const response = await fetch(ENDPOINT, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof body.message === "string" ? body.message : response.statusText;
    throw new Error(`GET auth config ${response.status}: ${message}`);
  }
  return body;
}

async function main(): Promise<void> {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) {
    console.error("SUPABASE_ACCESS_TOKEN is not set. Refusing to call the Management API.");
    process.exit(1);
  }

  const before = await readAuthConfig(token);
  const mailerBefore = Object.fromEntries(
    Object.entries(before).filter(([key]) => key.startsWith("mailer_") || key === "smtp_sender_name"),
  );
  console.log("before", JSON.stringify(redact(mailerBefore), null, 2));

  const patch: Record<string, string> = authTemplateConfigPatch();
  const sender = before.smtp_sender_name;
  if (sender !== "Taylslate") {
    patch.smtp_sender_name = "Taylslate";
    console.log(`smtp_sender_name was ${JSON.stringify(sender)}; setting it to Taylslate.`);
  }

  const response = await fetch(ENDPOINT, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  const patched = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof patched.message === "string" ? patched.message : response.statusText;
    throw new Error(`PATCH auth config ${response.status}: ${message}`);
  }

  const after = await readAuthConfig(token);
  const checks = [
    ["mailer_subjects_confirmation", "Confirm your Taylslate account"],
    ["mailer_subjects_magic_link", "Log in to Taylslate"],
    ["mailer_subjects_recovery", "Reset your Taylslate password"],
    ["mailer_templates_confirmation_content", "token_hash={{ .TokenHash }}"],
    ["mailer_templates_confirmation_content", "type=signup"],
    ["mailer_templates_confirmation_content", "next=/onboarding"],
    ["mailer_templates_magic_link_content", "type=magiclink"],
    ["mailer_templates_magic_link_content", "next=/dashboard"],
    ["mailer_templates_recovery_content", "type=recovery"],
    ["mailer_templates_recovery_content", "next=/reset-password"],
    ["mailer_templates_invite_content", "type=invite"],
    ["mailer_templates_email_change_content", "{{ .ConfirmationURL }}"],
    ["mailer_templates_confirmation_content", "#f2ebe1"],
  ] as const;

  let failed = 0;
  for (const [key, needle] of checks) {
    const value = String(after[key] ?? "");
    const ok = value.includes(needle);
    if (!ok) failed += 1;
    console.log(`${ok ? "ok" : "MISSING"} ${key} contains ${needle}`);
  }
  const confirm = String(after.mailer_templates_confirmation_content ?? "");
  const magic = String(after.mailer_templates_magic_link_content ?? "");
  const recovery = String(after.mailer_templates_recovery_content ?? "");
  for (const [name, html] of [
    ["confirmation", confirm],
    ["magic_link", magic],
    ["recovery", recovery],
  ] as const) {
    const leaked = html.includes(".ConfirmationURL");
    if (leaked) failed += 1;
    console.log(`${leaked ? "LEAK" : "ok"} ${name} has no .ConfirmationURL`);
  }
  console.log(`smtp_sender_name=${JSON.stringify(after.smtp_sender_name)}`);
  if (failed > 0) {
    throw new Error(`${failed} live template checks failed`);
  }
  console.log("Auth templates confirmed on", PROJECT_REF);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
