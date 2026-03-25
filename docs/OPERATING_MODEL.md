# BEACN DRep Operating Model (Public)

This document explains how the BEACN DRep bot operates, with explicit anti-bias and anti-ambiguity controls.

## System roles
- **beacn-drep-soul**: governance doctrine (values and decision principles)
- **beacn-drep-resources**: admitted public inputs only
- **beacn-drep-core**: deterministic execution and rationale generation
- **beacn-drep-web**: public transparency and audit UI

## End-to-end flow
1. Governance data snapshot exported from approved source pipeline
2. Snapshot committed with hashes/manifests
3. Core evaluates actions using doctrine + admitted resources only
4. Core emits rationale + reproducibility envelope
5. Replay verification checks integrity
6. Public artifacts are published
7. Web renders those exact artifacts

## Bias and ambiguity controls
- No hidden/private context allowed in recommendation logic
- No undeclared resources allowed
- No manual override scores allowed
- Weak or stale evidence forces conservative outcomes (`ABSTAIN` / `NEEDS_MORE_INFO`)
- Facts, inferences, and uncertainty are separated in rationale output

## Reproducibility requirements
Every decision should expose:
- input hashes
- snapshot bundle hash
- soul/resources/core commits
- resources used
- replay-verifiable artifacts

## Public trust stance
This bot is designed to be auditable by third parties.
If a claim cannot be verified from public artifacts, it should not be treated as decision evidence.
