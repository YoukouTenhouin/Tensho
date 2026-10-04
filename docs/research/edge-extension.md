# Edge lookup interactions and extension constraints

Research date: 2026-10-04. Planning evidence for [Investigate Edge lookup interactions and extension constraints](https://github.com/YoukouTenhouin/Tensho/issues/4). This is documentation research, not a browser-tested implementation or an architectural decision.

## Finding

The requested ordinary-webpage extension is feasible using Manifest V3. Microsoft lists `contextMenus`, `scripting`, `runtime`, `storage`, `commands`, and `permissions` as supported desktop Edge APIs, linking their Chromium references. These provide the necessary interaction, configuration, and communication mechanisms. API availability does not establish behavior on every page or a minimum tested Edge version. [Microsoft API support](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support)

The principal tradeoff is permission versus immediacy: explicit context-menu invocation supports temporary page access; always-ready selection and double-click detection require a content script already present. The final permission model and result UX remain decisions for the map.

## Lookup triggers and page access

| Trigger | Documented mechanism | Planning implication |
| --- | --- | --- |
| Double click | A content script observes the DOM `dblclick` event. The event specification includes text selection as a possible default action. | Read the resulting selection; do not assume the browser's word boundary rules equal Latin or Sanskrit linguistic segmentation. |
| Selection | `window.getSelection()` and `selectionchange` expose document selection. Nested documents have separate selections. | Snapshot text at invocation; decide whether selection merely offers a lookup control or starts a request. Account for keyboard selection and changes during dragging. |
| Context menu | `contextMenus` permission, `contexts: ["selection"]`, and `onClicked` provide `selectionText` and `frameId`. | Obtain the selected text directly; retain the originating frame when routing the result. |

Sources: [UI Events](https://www.w3.org/TR/uievents/#event-type-dblclick), [Selection API working draft](https://www.w3.org/TR/selection-api/), [contextMenus reference](https://developer.chrome.com/docs/extensions/reference/api/contextMenus). Planning implications are recommendations, not additional API guarantees.

`activeTab` grants temporary access following an extension action, context-menu command, registered keyboard command, or omnibox invocation. It does not list ordinary page text selection or double-click as an activating gesture. With `scripting`, it permits injection into the granted tab; its host grant concerns the main-frame origin and is revoked on navigation to another origin or tab closure. Therefore a context-menu-first mode can avoid persistent access to every reading site, but cannot promise passive triggers before activation. [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)

Content scripts can be static, dynamically registered, or injected on demand. They can read and change the DOM, with JavaScript globals isolated from the page by default. For frames, `all_frames` still respects URL matching; related `about:`, `data:`, or `blob:` frames have separate matching options. A top-level script should not be treated as universal access to embedded documents. Recommendations: start with permitted HTTP(S) reading documents, specify frame behavior explicitly, and handle missing scripts rather than silently dropping results. [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)

Optional host permissions can be requested during a user gesture. Known reading sites or backend hosts can be declared individually; runtime-discovered HTTPS hosts require a suitably broad optional declaration. Optional declarations are not grants. The extension must cope with refusal and revocation. This supports choosing and ordering supported providers without requiring arbitrary endpoint URLs in the first version. [Permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions)

## Results, networking, and lifecycle

An injected DOM surface is feasible because content scripts can modify the page. Its positioning, CSS isolation, selection preservation, and response to scrolling are implementation concerns still requiring a prototype. JavaScript isolation alone does not isolate the shared DOM from page scripts. [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)

Backend requests should be evaluated in an extension context, such as the service worker, with host permissions: content-script requests remain subject to the webpage origin's cross-origin restrictions even when the extension has those permissions. Backend hosts and reading-page hosts serve different purposes and should be accounted for separately. Host permission does not promise backend availability or an acceptable API contract. [Cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)

Treat returned data as untrusted for rendering. Prefer text nodes and explicitly constructed links over inserting backend HTML; use reviewed sanitization if rich markup is necessary. The request handler should accept an allowed provider identifier and query, rather than let page-originated messages turn it into an arbitrary-URL fetch proxy. These controls concern executable content, not correcting a provider's wrong-language definitions. [Cross-origin request security](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)

Chromium normally terminates a service worker after 30 seconds of inactivity, a request running more than five minutes, or a fetch response taking over 30 seconds to arrive; events can revive it. Globals are lost on shutdown. Planning consequence: keep configuration in persistent storage, make lookups bounded, and make interruption visible/retryable. Do not depend on an immortal background process. Exact lifecycle behavior should be checked against the chosen minimum Edge version. [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

`storage` provides asynchronous extension-specific JSON persistence accessible from extension contexts. `storage.local` is a suitable candidate for selected lookup language, explanation preferences, and per-language ordered provider settings. Content-script `window.localStorage` instead shares the page's storage. Restrict settings containing credentials to trusted contexts with supported access controls; do not mistake extension storage for a credential vault. Language-specific dispatch and cache keys are application requirements, not features automatically supplied by browser storage. [Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)

## Accessibility and supported surfaces

Choose the result surface's semantics before implementing focus behavior. If modal, WAI's dialog pattern requires focus inside the dialog, a contained tab sequence, Escape dismissal, a label, and sensible focus return. A nonmodal reading panel should not claim modal semantics or trap focus. Recommend a keyboard-accessible lookup path, focusable result controls, and dismissal without losing the reading position; the final interaction requires user review. [WAI dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)

If any result or control appears on hover or focus, the associated content must be dismissible, hoverable, and persistent under WCAG's applicable criterion. This does not mean every click-triggered lookup is a tooltip or automatically falls under that criterion. [WCAG content on hover or focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)

Do not promise lookup overlays on every browser surface. Chromium explicitly excludes restricted internal pages from `activeTab` access. Edge enterprise policies can also prevent extensions from changing specified sites. The precise Edge-owned/store domain restriction list was not established from the reviewed Microsoft sources; fail gracefully on injection errors rather than hard-coding an assumed complete list. PDF viewers, EPUB applications, image text, and OCR remain outside the agreed first-version surface. [activeTab restrictions](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [Edge extension policies](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-manage-extensions-policies)

For a personal-use first version, Microsoft documents loading an unpacked extension through Developer mode and **Load unpacked** at `edge://extensions`. Store publication is not required for that development/testing workflow. [Microsoft sideloading guide](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading)

## Decisions this evidence enables

- Decide whether passive lookup works on all granted sites, selected sites, or only after a per-tab activation.
- Decide selection-trigger behavior, keyboard access, dismissal, and result surface semantics together.
- Define frame support and the user-visible response when page access is unavailable.
- Specify provider permissions, interruption/error states, and language-specific routing independently of the browser UI.

No code or browser prototype was run. Later acceptance checks should cover an ordinary page, keyboard selection, permitted and unpermitted frames, denied site/backend permissions, worker restart, slow responses, navigation during lookup, hostile result markup, and switching lookup language while a request is pending. These are validation targets, not claims of completed testing.
