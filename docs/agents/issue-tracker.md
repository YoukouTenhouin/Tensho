# Issue tracker: GitHub

Issues and specs live in GitHub Issues for YoukouTenhouin/Tensho.
Use the gh CLI from this repository.

## Operations

- Create: gh issue create --title "..." --body-file <file>
- Read: gh issue view <number> --comments
- List: gh issue list --state open --json number,title,body,labels,comments
- Comment: gh issue comment <number> --body-file <file>
- Label: gh issue edit <number> --add-label "..." --remove-label "..."
- Close: gh issue close <number> --comment "..."

Write multiline issue bodies and comments to a temporary file and pass
--body-file. Read docs/agents/triage-labels.md when applying triage labels.

When a skill says "publish to the issue tracker", create a GitHub issue.
When it says "fetch the relevant ticket", read the issue and its comments.

## Pull requests as a triage surface

PRs as a request surface: no.

## Wayfinding

Use one issue labelled wayfinder:map for the map, with child tickets
linked as GitHub sub-issues. If sub-issues are unavailable, use a task
list in the map and a "Part of #<map>" line in each child.

Label children wayfinder:research, wayfinder:prototype,
wayfinder:grilling, or wayfinder:task.

Represent blockers with native GitHub issue dependencies. If unavailable,
use a "Blocked by: #<number>" line in the child. A ticket is unblocked
when all its blockers are closed.

Select the first open, unassigned, unblocked child in map order.
Claim it with gh issue edit <number> --add-assignee @me.
On resolution, comment with the result, close the child, and add a
summary and link to the map's Decisions-so-far.
