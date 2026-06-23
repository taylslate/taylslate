# Taylslate Future Feature Roadmap

*Last updated: June 11, 2026*

This document organizes the future feature set for Taylslate after the core Wave 14 discovery agent work. The strategic direction is to expand from podcast and YouTube sponsorship workflow into a broader creator sponsorship intelligence and execution layer, without prematurely becoming a generic Meta/Google/TikTok ad-buying tool.

## Strategic Frame

Taylslate should compete as:

**Your AI media buyer for creator sponsorships.**

The product should feel less like a podcast ad marketplace and more like an operator that understands the brand, designs the sponsorship test, executes the deal workflow, tracks outcomes, and remembers what worked.

The expansion path is:

1. Own podcast and long-form YouTube sponsorship execution.
2. Add creator-attached surfaces such as newsletter, social, and community.
3. Use sponsorship outcomes to generate paid amplification briefs.
4. Hand off to paid-media agents or brand teams rather than building generic paid ad buying first.
5. Eventually become the cross-channel command layer once Taylslate has enough proprietary outcome data.

## Near-Term Additions

These features are the most natural additions after Wave 14 Phase 2 because they strengthen the core sponsorship workflow.

### 1. Market Signal Layer

Add competitive and category intelligence directly into discovery reasoning.

Discovery cards should show:

- Similar advertisers or category history
- Direct competitor saturation
- Ad load / share-of-voice risk
- Estimated CPM or spend band
- Renewal signal when available
- Category benchmarks
- A short explanation of why the signal matters

The goal is not to become a standalone competitive intelligence database. The goal is to help the AI media buyer explain why a show belongs in the plan.

### 2. Tracking Basics

Add practical campaign tracking that can ship before deeper attribution integrations.

Core pieces:

- Promo code per deal
- UTM tracking link per deal
- Show notes blurb
- Brand-reported conversions
- Renewal / rebooking as a performance signal

Later, Taylslate can integrate attribution providers such as Podscribe or audio-pixel-style measurement partners. At launch, the important thing is to capture consistent signals and tie them back to the campaign thesis.

### 3. Learning Review Screen

After a campaign, Taylslate should show what it learned.

The review should answer:

- Which audience ring performed best?
- Which shows should be renewed?
- Which host/read style seemed to work?
- Which scale-tier shows are now worth testing?
- Which assumptions were wrong?
- What should future campaigns overweight or avoid?

This makes Taylslate's memory visible to the user instead of leaving it hidden in the database.

### 4. Creator-Attached Sellable Surfaces

Let creators add inventory beyond the core podcast read.

Potential surfaces:

- Podcast host-read ad
- Long-form YouTube integration
- Newsletter mention
- Instagram, TikTok, Reels, or Shorts clip
- X or LinkedIn host post
- Patreon, Discord, or community mention
- Live event or bonus episode package

For each surface, capture:

- Audience size
- Format
- Minimum buy
- Creative constraints
- Lead time
- Whether the creator/host or brand owns posting
- Price or rate card details

This moves Taylslate from "podcast ad workflow" toward "creator sponsorship workflow."

## Mid-Term Additions

These features become more useful once a few real campaigns have run through the platform.

### 5. Sponsorship-to-Paid Amplification Brief

After a host read works, Taylslate should generate a paid-media packet that a brand, agency, or external paid-media agent can execute.

The packet should include:

- Winning audience ring
- Why the sponsorship worked
- Suggested Meta, YouTube, TikTok, or other paid audiences
- Recommended clip or read asset
- Copy variants based on the host-read angle
- UTM links and promo code
- Suggested budget and flight length
- Success metric
- Expected interpretation of results

Version 1 should be export/share only. Later versions can hand the packet to an external agent via API or MCP.

### 6. Creator-Side Operating System

Build more durable creator-side workflow so shows and reps can manage their sponsorship business in Taylslate.

Creator-side features:

- Verified show profiles
- Rate cards
- Ad formats
- Audience data
- Brand history
- Sellable surfaces
- Availability
- Payment preferences
- Payout status
- Deal pipeline

This improves show-side conversion and creates proprietary data that competitors cannot easily scrape.

### 7. Agent / Rep Account UX

Support sales agents, rep companies, and portfolio managers.

Capabilities:

- Multi-show portfolio management
- Roster import and maintenance
- Centralized show onboarding
- Deal pipeline across represented shows
- Payment and billing setup across a portfolio
- Performance reporting by show and portfolio

This is high-leverage GTM because one rep can bring many shows onto the platform.

### 8. Make-Good Negotiation Agent

When delivery underperforms, Taylslate should help resolve the make-good.

Workflow:

- Detect underdelivery against IO terms
- Propose make-good options
- Draft amendment or updated terms
- Route for approval/signature
- Update deal and delivery state

This is a strong example of Taylslate behaving like an operator rather than a static workflow tool.

### 9. Invoice / Payment Reconciliation Agent

Add an agentic layer over payment operations.

Responsibilities:

- Watch Stripe and payout events
- Match payments to invoices and deals
- Flag failed charges or disputes
- Track overdue balances
- Trigger follow-up workflows
- Keep the deal ledger clean

This matters more as campaign volume increases.

## Long-Term Platform Layer

These features make sense after Taylslate has enough transaction volume and outcome data.

### 10. MCP / API Layer For Agents

Expose Taylslate's core primitives to external agents.

External agents should eventually be able to:

- Interpret a campaign brief
- Retrieve audience-ring hypotheses
- Get show recommendations
- Generate outreach
- Create or preview IO terms
- Check deal status
- Trigger signing/payment workflows
- Retrieve campaign learning summaries

This makes Taylslate the creator sponsorship primitive that other agents can call.

### 11. Digital Marketing OS Command Layer

Long-term, Taylslate can become the operating layer that coordinates creator sponsorships, creator-attached amplification, paid social, search, retargeting, and reporting.

Initial shape:

- Marketing budget planner
- Sponsorship vs paid amplification vs search/social/retargeting recommendations
- Cross-channel audience playbook
- Paid-media agent handoff
- Performance result ingestion
- Learning loop across all channels

Important constraint:

Taylslate should not build generic Meta/Google/TikTok buying first. Those channels are likely to be crowded with general paid-media agents. Taylslate's advantage is sponsorship-derived audience truth, creator creative, transaction memory, and outcome data.

## Recommended Build Order

1. Complete Wave 14 Phase 2: interpretation loop, conviction scoring, test portfolio, scale tier, founder annotations, promo/UTM basics.
2. Add market signal layer to discovery cards.
3. Add learning review screen after campaign completion.
4. Add creator-attached sellable surfaces to show onboarding.
5. Add sponsorship-to-paid amplification brief.
6. Expand creator-side OS and agent/rep workflows.
7. Add make-good and reconciliation agents.
8. Expose API/MCP primitives.
9. Build toward the digital marketing OS command layer once outcome data is strong enough.

## Positioning Guardrail

Do not message Taylslate as a free podcast directory, generic marketplace, or generic paid ad agent.

Message Taylslate as:

**An AI media buyer that plans, executes, pays, tracks, and learns from creator sponsorships.**
