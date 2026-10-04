# Native reading acceptance for ticket 14

The production development extension builds and routes reading actions through one browser-independent lookup coordinator. Ticket 14 remains incomplete pending the remaining acceptance work listed below. The user explicitly accepted native sidebar focus when opening on 2026-10-04; [ADR 0010](../adr/0010-native-sidebar-opening-focus.md) records the narrow revision. The current 36 KDE reading checks pass, including page-focus preservation for updates to an already-open panel and source-focus restoration on close.

## Reproducible evidence

Recorded on 2026-10-04 with Microsoft Edge 154.0.4258.37, openSUSE Tumbleweed 20260923, Plasma 6.7.5, KWin 6.7.5, Wayland session, and Edge using Xwayland. The isolated run uses Xvfb rather than KDE; the retained reading evidence is from the actual KDE session.

- [Native permission results](14-permission-scope.json), produced by `tests/native/permission_scope.py`: an explicit native HTTP grant permits script injection at the selected hostname and port, and rejects a different port, a child subdomain, and another hostname. The native permission API also reports the equivalent HTTPS origin as ungranted. Test hostnames resolve only to loopback; no application origin guards participate in these probes.
- [KDE reading results](14-reading-kde.json), produced by `tests/native/reading_workflow.py --desktop`: trusted double-click displays the controlled response; dragging and editable double-click do not replace the lookup; page clicks leave the panel open; manual lookup traverses the production interface; close restores page focus; pending completion does not reopen a closed panel. Page scroll remains unchanged during double-click opening.
- Both Alt+Shift+L and Alt+Shift+K register in actual Edge. During isolated interactive checks, Alt+Shift+L captured selected text and focused results; the original one-press Alt+Shift+K focus attempt failed when the sidebar was already open. The approved toggle now passes actual KDE/XTest delivery twice in succession, preserving result text and generation while closing/restoring page focus and reopening/focusing results. Alt+Shift+R was unbound and was replaced.
- [Production optional-access results](14-optional-access.json), produced by `tests/native/permission_workflow.py --output /tmp/tensho-access`: 18 checks pass against the unmodified production build on isolated Xvfb. Native XTest keyboard commands and editable context-menu lookup use temporary access without enabling automatic lookup. Context-menu lookup in an ungranted embedded origin also succeeds with browser-supplied text while native DOM injection remains denied. After a deliberate 35-second idle interval, the native worker disappears; a later context-menu lookup restarts it and updates the already-open panel. Native prompt denial leaves access disabled; granting records exactly one loopback origin. The local preference and optional grant survive a full browser-process restart, after which double-click works. Revoking the native grant stops automatic lookup while retaining the displayed result; native Escape closes the panel and restores reading-page focus.
- The optional-access runner enables Developer mode through Edge's settings UI before testing, matching the unpacked-install instructions. An earlier run omitted that step: after restart the disposable profile recorded disable reason `16777216`, and the extension worker was absent. [Chromium defines that reason](https://raw.githubusercontent.com/chromium/chromium/main/extensions/browser/disable_reason.h) as an unpacked developer extension disabled while Developer mode is off. Turning Developer mode on recovered automatic lookup with the same saved grant and preference. This was a harness installation defect; no production workaround was added.

## Accepted native focus revision

The [pre-revision evidence](14-reading-kde-before-focus-revision.json) demonstrated the earlier requirement could not be met by the tested paths. Immediately before double-click, the reading document has focus. After the sidebar opens and displays the requested word, the reading document reports `document.hasFocus() === false`, and the panel reports true. The original source element remains `document.activeElement`, which does **not** mean the page still receives keyboard input.

After independently putting native focus into the sidebar, none of these supported paths restored reading-document focus while the sidebar remained open:

1. Source-page `window.focus()` and `HTMLElement.focus({preventScroll:true})` through the production content script.
2. `chrome.tabs.update(tabId, {active:true})`.
3. `chrome.tabs.highlight({windowId, tabs:[index]})`.
4. `chrome.windows.update(windowId, {focused:true})`.

An additional exploratory main-world source focus attempt and panel `window.blur()` also did not restore it. Closing the sidebar does restore focus. These observations establish a failure in this tested build/environment; they do not prove that every possible browser implementation strategy is impossible.

The documented [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) exposes tab/window opening options but no option to suppress focus transfer. [Microsoft's sidebar documentation](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/sidebar) describes user-gesture opening. The implementation calls native opening synchronously from the message gesture after checking cached enabled/granted origins, and checks current metadata/permissions again before lookup. Awaiting browser queries before `open()` lost the native gesture in testing.

The user chose to accept native sidebar focus when opening, retaining Close/Escape source-focus restoration and reading-position preservation. The implementation skips redundant opening when the panel is already present, and native testing verifies that later double-click updates leave page focus in place. The parent spec and tickets 14 and 27 carry this accepted revision.

## Accepted keyboard toggle revision

The [pre-toggle evidence](14-reading-kde-before-toggle-revision.json) records the failed one-press focus attempts and successful close/reopen experiment. The user accepted Alt+Shift+K as a toggle; [ADR 0011](../adr/0011-native-sidebar-keyboard-toggle.md) records this decision. A closed sidebar opens with focus in one press; an already-open sidebar requires two presses, preserving results without another lookup. This is also the documented focus path after keyboard lookup updates an already-open panel.

## Remaining acceptance work

This is an incomplete vertical slice, not a release claim. The expanded KDE run covers keyboard routing through an enabled embedded frame, opaque/restricted manual recovery, visible keyboard focus and traversal out of the panel, missing-element and native Escape focus return without scrolling, immediate scroll reset during loading, rapid replacement and top-document navigation, and frame removal during pending analysis. The independent review found the missing frame-removal guard; the native regression first failed, then passed with source validation before publishing. Ungranted-frame keyboard recovery now passes: historical text in accessible frames cannot substitute for the focused inaccessible frame. Review follow-up and reproducible-build verification remain before reflow and PR. Subsequent provider, passage, settings, retention, fallback, and restart tickets remain separate work.

Controlled responses contain no linguistic claims. No live-provider acceptance, Orca acceptance, or production dictionary extraction is established by this ticket's current results.

## Frame capture regression and native input

Native frame selection uses XTest pointer events. Edge's floating text-selection menu can consume extension shortcuts; the runner dismisses it with native Escape before sending the command. The runner also spaces key press/release events to avoid zero-duration chords. The clean KDE run verifies both accessible-frame routing and ungranted/opaque-frame manual recovery. Earlier CDP-only frame pointer events did not reliably establish native keyboard delivery, so those failed shortcut-delivery attempts are not treated as product failures.

Historical capture follows parent/child WindowProxy indexes rather than iframe URLs. Parents with focused children are never substituted, even when the child has an empty `src`. The native redirected-sibling regression keeps a sibling at the original URL while independently navigating the selected frame; keyboard opening retrieves the selected frame's distinct text and browser frame identity. Inaccessible child frames offer context-menu/manual recovery rather than another frame's historical text.
