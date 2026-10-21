import { describe, expect, it } from "vitest";
import { assertShowOtpTemplate, authTemplateConfigPatch, renderAuthTemplates } from "./auth";

describe("Supabase auth email templates", () => {
  const templates = renderAuthTemplates();
  const byId = Object.fromEntries(templates.map((template) => [template.id, template]));

  it("keeps confirm, magic, recovery, and invite on token_hash links", () => {
    const confirm = byId["confirm-signup"].html;
    expect(confirm).toContain("token_hash={{ .TokenHash }}");
    expect(confirm).toContain("type=signup");
    expect(confirm).toContain("next=/onboarding");
    expect(confirm).not.toContain(".ConfirmationURL");
    expect(confirm).toContain(">Confirm email</a>");

    const magic = byId["magic-link"].html;
    expect(magic).toContain("type=magiclink");
    expect(magic).toContain("next=/dashboard");
    expect(magic).toContain("Here is your sign-in link. It expires in 24 hours.");
    expect(magic).not.toContain(".ConfirmationURL");

    const recovery = byId["recovery"].html;
    expect(recovery).toContain("type=recovery");
    expect(recovery).toContain("next=/reset-password");
    expect(recovery).toContain("If you did not ask for a reset");
    expect(recovery).not.toContain(".ConfirmationURL");

    const invite = byId["invite"].html;
    expect(invite).toContain("type=invite");
    expect(invite).toContain("next=/onboarding");
    expect(invite).not.toContain(".ConfirmationURL");
  });

  it("keeps email change on ConfirmationURL and reauthentication on a code", () => {
    const change = byId["email-change"];
    expect(change.html).toContain("{{ .ConfirmationURL }}");
    expect(change.html).toContain("{{ .NewEmail }}");
    expect(change.html).not.toContain("token_hash=");
    expect(change.subject).toBe("Confirm your new Taylslate email");

    const code = byId["reauthentication"];
    expect(code.subject).toBe("Your Taylslate verification code");
    expect(code.html).toContain("{{ .Token }}");
    expect(code.html).not.toContain("token_hash=");
    expect(code.html).not.toContain(".ConfirmationURL");
  });

  it("keeps the show OTP template as a code on the shared layout", () => {
    const otp = byId.otp;
    expect(otp.subject).toBe("Your Taylslate sign-in code");
    expect(otp.html).toContain("{{ .Token }}");
    expect(otp.html).toContain('data-taylslate-email="1"');
    expect(otp.html).toContain("#ffffff");
    expect(otp.html).not.toContain("#f2ebe1");
    expect(otp.html).not.toContain(".ConfirmationURL");
    expect(otp.html).not.toContain("token_hash=");
    expect(() => assertShowOtpTemplate()).not.toThrow();
  });

  it("patches only subject and content fields", () => {
    const patch = authTemplateConfigPatch();
    const keys = Object.keys(patch);
    expect(keys.every((key) => key.startsWith("mailer_subjects_") || key.startsWith("mailer_templates_"))).toBe(true);
    expect(keys.some((key) => key.includes("enabled"))).toBe(false);
    expect(keys.some((key) => key.startsWith("smtp_"))).toBe(false);
    expect(patch.mailer_subjects_confirmation).toBe("Confirm your Taylslate account");
    expect(patch).not.toHaveProperty("mailer_subjects_otp");
    expect(patch.mailer_templates_magic_link_content).toContain("type=magiclink");
    expect(patch.mailer_subjects_recovery).toBe("Reset your Taylslate password");
    for (const html of Object.values(patch).filter((value) => value.includes("<html"))) {
      expect(html.length).toBeLessThan(5000);
    }
  });
});
