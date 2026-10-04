# Ticket 14 review

Reviewed `e90c3f4...18bb766` against the approved ticket 14 specification, including the two accepted native focus revisions. The code-review skill ran Standards and Spec reviews independently. Later fixes and follow-up reviews are tracked below.

## Standards

No documented-standard violations found. The page/worker/panel boundary follows ADR 0006; accepted focus behavior follows ADRs 0010–0011. Session restoration is explicitly subsequent work in this development slice.

Two possible smells, both judgment calls:

- **Primitive Obsession:** the panel/worker message protocol uses `Record<string, unknown>` and `Promise<any>`, independently repeating message names and payload shapes. Shared discriminated request/response types would let TypeScript check internal protocol changes; incoming messages still need runtime validation.
- **Duplicated Code:** native reading and permission runners repeat Xvfb startup and cleanup. A shared isolated-display context manager would make timeout and cleanup fixes consistent while retaining their different permission setups.

These are maintainability suggestions, not acceptance failures.

## Spec

**Frame removal:** invalidating requests only on committed navigation does not cover detaching an iframe while analysis is pending. The spec requires binding work to frame and document. The new native regression reproduced this; validating source identity before publishing now passes it. A unit test also proves that delayed validation cannot clear newer work.

**Ungranted-frame keyboard capture:** the reviewer raised an unconfirmed possibility that an inaccessible frame could cause lookup of historical text in an accessible frame. Native testing subsequently confirmed stale top-page text was used. The active-focus-path correction now uses parent/child WindowProxy indexes, avoiding stale DOM src attributes and duplicate-URL confusion. Native follow-up passes for accessible, ungranted, opaque, and independently navigated frames.

No scope creep was identified. Live providers, passages, settings, bounded retention, and full interruption recovery remain separate tickets.

## Follow-up

Native investigation also confirmed that worker idle shutdown disconnected the panel's notification port: a new context-menu lookup completed but the panel displayed old text. Runtime change notifications now reconnect the panel, and the production-build idle test verifies that a new lookup updates the existing panel after the worker has stopped.

Standards: 0 hard violations and 2 maintainability suggestions; the internal message protocol is the larger maintainability concern. Spec: 2 correctness findings, both verified fixed. The reviewer found no remaining must-fix issue in the frame-index correction. Numeric frame indexes could change during sequential capture if the page inserts/removes siblings; that concurrency edge remains a future coverage opportunity. The separately identified first toggle after worker idle shutdown is corrected with an existing-panel probe and synchronous native opening; a regression confirms real worker suspension before first-press closure and second-press opening.
