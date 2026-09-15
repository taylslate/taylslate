# Taylslate as a sponsorship agent harness

Recorded September 15, 2026.

**Status: founder-requested future direction; deferred for future build.** Chris asked to preserve the desire for Taylslate to become a domain-specific harness following the September 14–15 discussion. This records the aspiration, not approval of an implementation plan, vendor, budget, or new launch prerequisite.

## Desired outcome

Taylslate becomes the environment in which an AI media buyer can execute sponsorship work: understand a campaign, research shows, prepare a plan, coordinate approved outreach and agreements, track delivery, and progress payment workflows within explicit authority boundaries.

The product combines a system of record with the tools, workflow state, controls, and verification an agent needs to act reliably. The system of record captures what was agreed and what happened. The harness uses that state to determine what can happen next, carry out permitted actions, and verify the result.

This extends the existing agent-native product thesis. It is separate from the Company Brain and internal AI workers used to operate Taylslate as a business.

## Illustrative experience

“Find suitable shows for this product and prepare a $20,000 test campaign. Bring me the plan before contacting anyone.”

The agent gathers context, forms hypotheses, researches candidates, calculates costs, and prepares a reviewable plan. It stops at the requested approval boundary. After authorization, it could continue the approved workflow, preserve progress across waits for people or services, and report outcomes or exceptions.

This is a future experience, not a claim that the complete autonomous workflow exists today.

## Capabilities to scope when revisited

- **Campaign context:** brand knowledge, budget, exclusions, prior decisions, and evidenced outcomes.
- **Domain tools:** bounded operations for discovery, pricing, planning, outreach, IOs, delivery, and payments.
- **Durable execution:** persisted task state, resumable work, asynchronous events, and recovery from partial failures without duplicating external actions.
- **Authority and controls:** explicit permissions, approval checkpoints, budget limits, valid deal transitions, and enforced financial rules.
- **Verification:** observable completion criteria for each step; distinguish a drafted plan, a sent message, an accepted deal, a signed agreement, and a confirmed financial outcome.
- **Learning:** capture reasoning and human corrections with provenance; evaluate changes before turning individual corrections into general rules.

Existing campaign/deal records, domain logic, integrations, and reasoning logs are foundations to assess at scoping time. They do not by themselves constitute a complete agent harness.

## Design stance to evaluate

Own the sponsorship-specific rules, state, evidence, and execution contracts. Evaluate existing agent runtimes for generic orchestration, context management, and compute. Building a domain harness does not inherently require building those primitives from scratch.

Keep data and tool contracts portable where practical. Provider selection, model routing, orchestration architecture, and any custom runtime remain undecided. Critical authorization and financial checks must be enforced by application logic, not delegated to the model's judgment alone.

MCP or an API can expose tools to external agents; that interface alone does not supply durable orchestration, approvals, or outcome verification. This direction complements the future MCP work without pulling it forward.

## Hold and revisit

**Hold for future build. No change to current priorities.**

Suggested revisit trigger: once the core transaction workflow is proven and real customer use identifies a repeated, valuable multi-step job worth delegating. At that point, scope one bounded workflow and define:

1. The customer outcome and evidence required to declare it complete.
2. Actions that may run autonomously and those requiring approval.
3. Failure, retry, cancellation, and handoff behavior.
4. A small set of realistic evaluation cases, including exceptions.
5. Success measures such as completion reliability, founder intervention, cost, and elapsed time.

The trigger and implementation details above are planning suggestions, not a scheduled commitment. A later build decision should use current product state and customer evidence.

## Related context

- [Product backlog — future work](../PRODUCT_BACKLOG.md)
- [Future feature roadmap](FUTURE_FEATURE_ROADMAP.md)
- [Company Brain decision index](../company-brain/DECISION_INDEX.md)
- [Master architecture](architecture-logs/TAYLSLATE_MASTER_ARCHITECTURE.md): agent-native design and transaction workflow
