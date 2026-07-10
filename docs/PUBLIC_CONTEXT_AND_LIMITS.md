# Public Context & Decision Limits (BEACN DRep)

This file states, in plain language, what *can* and *cannot* influence BEACN DRep recommendations.

## What can influence decisions

Only these public, reproducible inputs:

1. **Doctrine** from `beacn-drep-soul` (pinned by commit hash).
2. **Admitted resources** from `beacn-drep-resources` registry and snapshot files.
3. **Deterministic execution logic** in `beacn-drep-core`.
4. **Published artifacts** (`rationale.json`, `rationale.md`, `input_manifest.json`) with hashes for replay.

## What cannot influence decisions

The following are explicitly excluded from decision logic:

- OpenClaw private memory (`MEMORY.md`, daily memory logs, local assistant notes)
- Personal chats, DMs, private messages, or unpublished human notes
- Hidden prompts or undeclared context
- Manual score overrides not represented in public code/inputs
- Any off-registry dataset

## Integrity constraints

- If data is stale or critical evidence is missing, the system should return **ABSTAIN** or **NEEDS_MORE_INFO**.
- Every recommendation must include reproducibility metadata (hashes + commit pointers + resources used).
- Public artifacts must be published before/with finalized recommendation output.
- Replay verification must pass for trustable results.

## Treasury stewardship boundary

- The system is fiscally responsible, not anti-spending.
- Strategic spending can be recommended when expected public benefit, delivery capacity, and accountability are clear.
- Budget scope, cost assumptions, and sustainability logic should be explicit enough for public review.
- Where proposal sustainability depends on fee recovery or ongoing support, that dependency should be clearly stated and testable.
- If financial sustainability context is materially incomplete, confidence should be reduced and conservative outcomes are preferred.
- Missing evidence is not negative evidence: it yields `NEEDS_MORE_INFO` or `ABSTAIN`, never a
  penalty-driven treasury `NO`.
- Treasury `YES` requires independently pinned ecosystem benefit plus delivery, cost-efficiency,
  and downside-protection floors. Treasury `NO` requires affirmative independently pinned evidence
  of waste, duplication, excessive cost, delivery failure, private capture, or unacceptable downside.
- A proposal anchor proves what the proposer said; it is not independent proof that the claim is true.

## Why this exists

Open-source governance is not just open code — it requires auditable decision boundaries.
This document makes the boundary explicit so anyone can verify what influenced a decision.
