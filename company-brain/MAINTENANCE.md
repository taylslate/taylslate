# Maintaining the Company Brain

Initial working procedure, September 9, 2026. This is a proposed lightweight documentation workflow, not a new external-action permission policy. Chris's task instructions and existing authorization govern actual work.

## One source for each fact

Keep current build state in STATUS, work items in PRODUCT_BACKLOG, detailed decisions in their decision records, and raw evidence in its appropriate source system. The Company Brain gives short summaries and links. Update a summary when its source changes; avoid copying an entire specification into another file.

Before substantive work, read START_HERE and the relevant domain sources. Before relying on volatile information, check its effective date and any known conflict. Read original sources when precision matters. A local folder can be shared across local AI tools, but other tools require an explicit connector or export; no automatic synchronization exists today.

## End-of-work capture

After meaningful work:

1. Record new evidence with its source, date, scope, and limitations.
2. Record any actual decision, including rationale and rejected alternatives. Attribute approval to the person and source that establishes it.
3. Update the authoritative current-state record when evidence supports a change. Distinguish implemented, tested, deployed, and live-verified.
4. Update the short Company Brain summary or index only where needed.
5. Link superseded records and resolve or retain conflicts explicitly.

Routine factual updates can follow the user's authorized task scope. An AI inference must remain labeled as an inference; it cannot silently become a pricing, positioning, legal, or spending decision.

Review the index when a major decision, launch milestone, customer learning, or financial reporting cycle occurs. A weekly review is a possible later operating cadence; no recurring task has been scheduled.

## Evidence template

```markdown
# CB-E-### — Observation
Recorded:
Observed on:
Source / original location:
Recorded by:
Access: internal / restricted / approved for public use
Type: customer statement / measured behavior / production proof / research / founder recollection

Observation:
Scope and sample:
Interpretation (separate from observation):
Limitations and alternative explanations:
Related decisions or experiments:
```

## Decision template

```markdown
# CB-D-### — Decision title
Status: proposed / approved / superseded
Recorded:
Effective:
Decision-maker and approval source:
Source evidence:
Supersedes / superseded by:

Decision:
Problem and context:
Alternatives considered:
Why this choice:
Expected outcome (not yet an observed result):
Tradeoffs and consequences:
Revisit date or evidence trigger:
Affected documents and workflows:
```

## Experiment template

```markdown
# CB-X-### — Experiment title
Status: proposed / running / completed / stopped
Owner:
Hypothesis:
Audience and scope:
Action and time window:
Success measure and decision threshold:
Budget / authorization source, if applicable:
Evidence links:
Observed results:
Limitations:
Decision and next step:
```

## Sensitive information and claims

Keep general company summaries separate from sensitive originals. Use a permissioned document or system for signed contracts, financial exports, personal customer data, and interview transcripts. Store secrets in the existing secret-management mechanism, never in Markdown. A folder name or “restricted” label does not enforce permissions.

Before giving an outside tool company context, review the specific files and source links it will receive. Do not assume a whole-repository export is appropriate. For public claims, preserve a substantiating source, last verification date, and approved wording; dated competitor opinions and forecast assumptions are not an approved claims library.

## Completion criteria for the next iteration

The next useful iteration should recover the missing validation source, resolve the first-buyer emphasis, and locate actual operating records. Add domain documents only when there is enough source material or real ongoing work to maintain them. Avoid creating empty departments or autonomous roles solely to match an organization chart.
