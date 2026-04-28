# Taylslate Pricing Decisions

*Locked April 28, 2026. Source of truth for the pricing model, the reasoning behind it, and the Wave 13 architectural requirements that follow from it.*

This document is for engineering reference during Wave 13 build and beyond. For full strategic context, see `TAYLSLATE_CONTEXT.md` Section 4. For build-state and conventions, see `CLAUDE.md`.

---

## The Three Plans

### Pay-as-you-go (Brand entry)
- **10% transaction fee, no subscription**
- 1 seat
- Up to 2 concurrent active campaigns
- Per-campaign reporting only
- Standard support
- No API access
- All core features (AI planning, discovery, IO generation, verification, invoicing, payment)

### Operator (Brand committed)
- **$499/month + 6% transaction**
- Breakeven vs PAYG at ~$12,500/month spend
- 1 seat included, additional seats at $299/month
- Unlimited concurrent campaigns
- Portfolio dashboard, cross-campaign analytics, CSV exports
- Priority support
- API access
- All Pay-as-you-go features

### Agency (white-label)
- **$5,000/month + 4% transaction**
- 5 seats included, additional seats at $500/month
- White-label IOs and dashboards
- Multi-client architecture, permissions, client billing separation
- Custom reporting
- Dedicated success manager
- All Operator features

---

## Pricing Philosophy

**Transaction fee is the entry. SaaS is the upgrade for ongoing operations.** Customers earn their way to SaaS rather than being gated into it. Founder-buyers testing podcast advertising for the first time start on PAYG with no recurring fee. Once they prove the channel and run consistent monthly spend, they convert to Operator for better economics.

**Reference class is commerce infrastructure (Shopify, Toast), not marketing suites (HubSpot, Salesforce).** Taylslate is a channel tool — "Facebook Ads for podcast reads" — not a full marketing platform. $499/month anchors to "operations tool for podcast advertising." Higher SaaS prices ($1,500+) would conflict with the channel-tool positioning.

**Optimize for churn over per-customer revenue.** PAYG generates more per-customer revenue than Operator at high volumes (10% on $100K/month = $10K vs Operator's $5,999), but Operator customers retain dramatically longer because the platform gets cheaper as they scale rather than more expensive. Higher LTV through stickier relationships beats higher per-month revenue from volatile transaction-only customers.

**Don't gate the wedge. Gate the scale features.** AI planning, discovery, IO generation, verification, invoicing, and payment are the wedge — must be available to everyone. Things that only matter at scale (concurrent campaign caps, portfolio dashboard, API access, multi-client architecture, white-label) gate naturally to the tier where they're actually needed.

**Customer chooses, platform doesn't force.** No mandatory graduation by volume thresholds. Some customers will stay on PAYG even when Operator is cheaper because they value zero monthly fee. Respect that choice.

---

## Why Other Models Were Rejected

- **Pure 8% transaction (previous model):** Doesn't generate recurring revenue, structurally caps exit multiple, fights retention at scale.
- **Pure SaaS:** Sticker shock at the entry point. Founders testing podcast advertising for the first time won't sign up for $1,500/month before knowing the channel works.
- **Feature-gated tiers (gate features behind SaaS):** Taylslate's value is in the wedge features. Gating those undermines the entire pitch.
- **Per-campaign / per-discovery / per-outreach metering:** Too much billing complexity for too little revenue. Doesn't fit the customer's mental model.
- **Listing fees / featured placement for shows:** Compromises discovery integrity. The mission is helping shows that don't get enough ad dollars find more deals — pay-to-play discovery contradicts that. Killed permanently.
- **$1,500/mo Operator price:** Too high for the founder-buyer reference class. They compare Taylslate to Facebook Ads / Google Ads (channel tools), not to HubSpot (marketing suite). $499 anchors correctly.

---

## Three Revenue Streams (Three Modes of Using Taylslate)

The streams are three distinct *modes of using the platform*:

1. **Transaction (PAYG, 10%)** — "Human running campaigns through the UI occasionally." Day 1 entry point.
2. **SaaS (Operator $499+6%, Agency $5,000+4%)** — "Human running campaigns through the UI consistently." Month 3+ recurring revenue engine.
3. **API/MCP (per-call + per-deal pricing)** — "Agents running campaigns programmatically." Month 9-12+ for agent-mediated commerce.

### API/MCP Pricing Shape (Future, Don't Decide Now)

When the API/MCP product matures (Month 9-12+):
- Per-call pricing for read operations (discovery runs, show lookups, scoring queries) — roughly $0.10-$0.50/call
- Per-deal pricing for write operations (campaigns created, IOs generated) — roughly $5-$25/IO
- 1-2% additional surcharge on transactions executed via API (on top of customer's underlying plan rate)
- Probably NOT a flat monthly subscription for API access — fights the "agents pay per use" model

Don't decide API pricing now. **Wave 13 must log every API call with customer ID, timestamp, and operation type.** That data enables intelligent pricing in 12 months.

---

## Conversion Mechanic (Highest-Leverage Activity)

PAYG → Operator conversion rate is the single most important metric in the company. Every percentage point moves year-3+ revenue dramatically. The CS function and trigger system are non-negotiable, not nice-to-have.

### Internal trigger system (build in Wave 13)
- When a customer's trailing 90-day GMV averages above $12,500/month, fire an internal alert
- Alert goes to Chris initially, then to a CS person once that role exists
- Includes the math: "Customer X spending $Y/month. PAYG cost: $Z. Operator would save them $W/year."
- Triggers a sales-led upgrade conversation, not an automated email

### Customer-facing signal (build later)
- Subtle dashboard indicator showing estimated savings if they switched
- No popups, no pressure — just shows the math so customers can self-discover

### Switching mechanics
- Friction-free, prorated through Stripe Subscription primitives
- Keep all data, deal history, customer relationship intact
- Allow downgrades back to PAYG if customer requests (don't trap them)

---

## Wave 13 Architectural Requirements

These must happen in Wave 13 because retrofitting later is painful or impossible.

### 1. Customer plan field
- `plan` enum on customer/account record: `pay_as_you_go`, `operator`, `agency`
- Default `pay_as_you_go` for all new accounts at launch

### 2. Per-customer dynamic transaction fee
- `platform_fee_percentage` stored on customer record (e.g., `0.10`, `0.06`, `0.04`)
- Stripe Connect `application_fee_amount` calculated **per-charge from this field**
- **Never hardcode 10% (or any rate) anywhere in the codebase**
- Migration must default existing accounts to `0.10`

### 3. Stripe Subscription billing
- Set up subscription products and prices for Operator ($499/mo) and Agency ($5,000/mo) **even with zero subscribers at launch**
- Adding subscription billing to a Connect-only account later is a real migration
- Per-seat add-on prices: Operator additional seat $299/mo, Agency additional seat $500/mo

### 4. Seat counting
- `seat_count` on customer record (default 1)
- Per-seat billing via Stripe Subscription quantity
- Architect for it even if launch is single-seat

### 5. Plan switching with proration
- Use Stripe Subscription's built-in proration, not custom logic
- Switching mid-month should "just work" through Stripe primitives
- Support PAYG → Operator, Operator → PAYG (downgrades allowed), Operator → Agency, etc.

### 6. Event logging at fine granularity
- Log every: campaign generation, discovery run, IO generation, outreach sent, API call
- Schema: customer_id, timestamp, operation_type, optional metadata
- **Even if nothing is metered now**, this is the foundation for the API revenue stream
- Backfilling later is impossible

### 7. GMV trigger alerting
- Trailing 90-day GMV calculation per customer (rolling, recomputed on each transaction)
- Alert system fires when customer crosses Operator breakeven ($12,500/month average)
- Alert goes to internal team (initially Chris) — Slack/email is fine
- The conversion mechanic must work from day Wave 13 ships

---

## Real Buyer Minimum

**$30K-$50K/month campaigns** (revised from earlier $20K assumption based on customer reality).

This is the floor of the brand-side target customer. Plans are designed around this profile:
- A test-phase founder running their first $30K-$50K campaign pays $3K-$5K on PAYG
- Same customer at $40K/month sustained crosses the Operator breakeven and upgrades
- Operator customers averaging $80K-$100K/month are the company's economic backbone

---

## Revenue Projections (Base Case, No Agencies)

Agencies are pure upside, not in the base model. Treat agency adoption as gravy.

- **Year 1:** ~$900K total revenue
- **Year 2:** ~$4.5M
- **Year 3:** ~$15.8M (~$11M recurring, 70% recurring share)
- **Year 4:** ~$36M
- **Year 5:** ~$74M
- **Year 6:** ~$90M revenue (77% recurring) → $720M-$900M exit at 8-10x blended multiple

**Path to $1B exit:** Operator retention at high volumes ($100K-$200K/month customers) is the primary lever. If those customers stay on the platform rather than going in-house, year 6 revenue jumps to $100-105M and $1B exit becomes comfortable. Agency adoption and faster API/agent ecosystem maturity are upside levers on top.

---

## Three Things That Determine Whether This Works

1. **Operator conversion rate.** Target 40-50% of brands who run more than one campaign convert to Operator within 6 months. The CS function and trigger system are how this gets achieved.

2. **Operator retention at high volumes.** Customers spending $100K-$200K/month must stay on Operator rather than leaving for in-house. The product needs to be undeniably better than spreadsheets and a hired media buyer at that scale. Year 3-5 product roadmap should obsess over "what does the $200K/month Operator customer need next?"

3. **API revenue maturity by year 3-4.** Depends on whether AI agents become a real commerce channel. If yes, meaningful third revenue line. If no, the model still works but caps lower.

---

## Investor Pitch Shape

> "Brand-side transaction fee gets customers in the door at zero adoption friction. Most active customers convert to a $499/month + 6% Operator plan within 6 months once they prove the channel. By year 3, recurring revenue is ~70% of total. By year 6 we project $90M revenue, 77% recurring, with agencies and API revenue as upside levers. The model is structurally optimized for retention — customers stay because the platform gets cheaper as they scale, not more expensive."
