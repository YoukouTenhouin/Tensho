## Agent skills

### Issue tracker

Track issues and specs in GitHub Issues. Before working with tickets, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. Before triaging issues, read `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context layout. Before exploring the codebase, read `docs/agents/domain.md`.

## Feature implementation workflow

Apply this workflow to each feature implementation ticket. Documentation-only updates and other non-feature work are out of scope.

1. Create a ticket-specific branch from `master` named `<ticket>-dev`.
2. Implement the feature on the dev branch, committing frequently in small, incremental steps.
3. Once implementation is complete and the required tests pass, create `<ticket>-reflow` from the dev branch. Preserve the dev branch while reorganizing the reflow branch's commits into a clean, logical history of small increments.
4. Verify that the final tips of the dev and reflow branches have identical Git trees: `git rev-parse <ticket>-dev^{tree} <ticket>-reflow^{tree}` must print the same tree ID twice.
5. Push the reflow branch and create a pull request from `<ticket>-reflow` to `master`.

## Desktop testing

The user reserves `HDMI-A-1` for test windows throughout the implementation goal. Place shared-desktop test windows on that monitor and verify their placement before sending native input. Use isolated displays when a shared-desktop test is unnecessary, keeping the other monitors available for the user's work.

Run speech tests through `python3 tests/native/silent_speech.py -- <command>` so their private speech dispatcher uses a temporary silent output. Keep test speech off the user's headphones and preserve the user's audio routing and volume settings.
