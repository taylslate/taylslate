# Taylslate

Start with the [Company Brain](company-brain/START_HERE.md) for company context, source documents, decision history, and known information gaps. For engineering, read [CLAUDE.md](CLAUDE.md), [AGENTS.md](AGENTS.md), and [STATUS.md](STATUS.md).

## Current truth (Oct 21, 2026)

This block wins over anything older in this file or in other docs.

- **Sign-in:** everyone, brands and shows, signs in with a 6-digit code sent by email (`/login` → `POST /api/auth/login/otp/*`, mail from `lib/email/templates/login-otp.ts` via Resend). Passwords and magic links are not the sign-in path. Rate limits live in `public.login_otp_limits` (migration 051).
- **Teams:** No team roles or permissions to start (the brand/show view switch still exists). Seats are not sold and not limited (unlimited seats). `seatsIncluded` on the plan record is data only and not enforced.
- **Pricing (locked, see `PRICING_DECISIONS.md`):** brand pays. Free $0 (1 active campaign), Starter $79/mo (5 active campaigns + CRM), Operator $299/mo (unlimited campaigns, full CRM). Fees, card / bank transfer: Free 10% / 7%, Starter 8% / 5%, Operator 6% / 3%. Shows are free and pay no fee. No public Agency tier.
- **Design:** Ink & Gold. Hexes: navy #1B2A4A, ink #141C2B, canvas #F6F5F2, gold #8C6E1F (marks only), text gold #7A5F17 via `--ts-accent-text`. Fraunces headings. HubSpot-style crisp white cards. All emails: white #ffffff with a thin ink header bar and logo. No em dashes in email copy. This is not the old beige theme. Tokens: `lib/brand/tokens.ts`, `lib/brand/tokens.css`, `lib/email/layout.ts`.
- **Public pages:** homepage and `/for-shows` are live.
- **Launch:** January 2027.
- **Migrations on `ldtmhafewfifdizgfrnn`:** 001–051 applied. 045 (benchmarks + media-kit geography), 046 (podscan_id guard trigger), 047 (campaign learning tables), 048 (make_goods), 049 (show_surfaces anon revoke), 050 (`user_owns_show` without podscan match) were applied Oct 21, 2026. 051 (`login_otp_limits`) was applied earlier the same day. Never re-run a file.
- **Open manual settings:** Supabase Auth email templates need `scripts/apply-auth-email-templates.ts` run with a `SUPABASE_ACCESS_TOKEN`. Email OTP expiry is a dashboard setting (Authentication → Sign In / Providers → Email → Email OTP Expiration). `SUPABASE_SERVICE_ROLE_KEY` is set for Production only, not Preview.


This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
