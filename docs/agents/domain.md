# Domain docs

## Layout and reading rules

This repository uses a single-context layout:

- CONTEXT.md at the repository root holds domain terminology.
- docs/adr/ holds architectural decision records.

Before exploring the codebase, read CONTEXT.md and ADRs relevant to
the area being explored.

If these files are absent, proceed silently. Domain documentation is
created lazily through the domain-modeling skill when terminology
or decisions are resolved.

## Vocabulary

Use the glossary's terms in issue titles, proposals, hypotheses, and
test names. If a needed concept is missing, reconsider the wording
or note the gap for domain-modeling.

## Decision conflicts

If a proposal contradicts an existing ADR, identify the ADR and
explain why its decision should be reconsidered.
