"use client";

import OnboardingShell from "../onboarding-shell";

export default function WelcomePage() {
  return (
    <OnboardingShell
      slug="welcome"
      title="Let's set up your brand."
      subtitle="Takes 2-3 minutes. This helps us find shows that actually match — not just shows with the biggest audiences."
      continueLabel="Get started"
      hideBack
    >
      <div className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-6 space-y-4">
        <Bullet
          num={1}
          title="Tell us what you sell"
          body="A sentence about your product and who it's for."
        />
        <Bullet
          num={2}
          title="Describe your customer"
          body="Age, interests, and a sentence or two about them."
        />
        <Bullet
          num={3}
          title="Pick content categories"
          body="What shows would your ideal customer already be listening to?"
        />
        <Bullet
          num={4}
          title="Save &amp; launch campaigns"
          body="We'll use this to score every show every time you create a campaign."
        />
      </div>
    </OnboardingShell>
  );
}

function Bullet({ num, title, body }: { num: number; title: string; body: string }) {
  return (
    <div className="flex gap-4">
      <div className="w-7 h-7 rounded-full bg-[var(--brand-blue)]/10 text-[var(--brand-blue)] flex items-center justify-center text-xs font-bold flex-shrink-0">
        {num}
      </div>
      <div>
        <div className="font-semibold text-[var(--brand-text)]">{title}</div>
        <div className="text-sm text-[var(--brand-text-secondary)]">{body}</div>
      </div>
    </div>
  );
}
