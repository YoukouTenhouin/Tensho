# Tensho Latin reading extension

Tensho is a personal-use Microsoft Edge reading extension for openSUSE Tumbleweed and KDE Plasma. It looks up selected or manually entered words through Alpheios-hosted Whitaker after explicit provider access. It also resolves uncertain Lewis & Short alternatives and retrieves full articles on request. Completed reading results are retained per tab for the browser session.

The native reading workflow follows the accepted sidebar focus contract. The user-approved focus policy allows Edge to move keyboard focus into the sidebar when opening it; updates to an already-open panel preserve page focus, and Close/Escape restores it. See [native acceptance evidence](docs/validation/14-native-acceptance.md).

## Build and load

Use Node.js 24 and npm 11 (validated with Node 24.18.1 and npm 11.16.0). Dependencies are pinned in `package-lock.json`.

```sh
npm ci
npm run check
```

In Microsoft Edge 154 or newer, open `edge://extensions`, enable Developer mode, choose **Load unpacked**, and select this repository's `dist` directory. To update, rerun `npm run check` and click **Reload** for Tensho on that page. Reload reading pages so their content scripts use the new build.

The UI starts with Latin lookup and English explanations. Reading-site access and Latin provider access are separate. Use **Enable Latin providers** to request the two default Alpheios origins; granting access does not send a lookup. Completed reading state, expansion, selection context, and panel scroll survive sidebar closure and worker restart in browser-session storage. Reload, a different document, or browser restart clears reading results; settings and site enablement remain local.

## Read and look up words

- Enable Latin providers, then select a word or enter it manually. Results preserve supplied candidate boundaries, grammar, English short meanings, and attribution. Missing access, no Latin match, missing information, and technical failure remain distinct. A failed lookup offers **Retry Latin analysis**; there are no automatic retries.
- Select a passage with the context menu or **Alt+Shift+L**, or enter it manually. The original selection and word buttons stay visible while you study a chosen word. Opening a passage sends no analysis; each word choice sends only that word. Limits are 4,096 Unicode code points per selection, 256 per offered word, and 256 offered words. Oversized input is rejected without truncation. Internal apostrophes, hyphens, diacritics, and enclitics remain intact. In the manual field, Enter submits and Shift+Enter inserts a newline.
- Open **dictionary alternatives** beneath a candidate to resolve possible Lewis & Short entries. Labels show the actual index keys and entry identifiers; correspondence remains unverified, including a singleton. Choose **Read full article** to retrieve an entry. Multiple articles can remain visible, with complete readable text, attribution, and safe source links. Dictionary failures offer local retry without rerunning analysis. An unresolved mapping does not establish that the dictionary has no entry.
- Press **Alt+Shift+L** to look up accessible selected text. Opening the sidebar focuses results; if it is already open, use the toggle below to move focus into it. Temporary native page access does not enable automatic lookup.
- Press **Alt+Shift+K** to toggle existing results without another lookup. When closed, one press opens and focuses them; when already open, press twice to close and reopen with focus. Dismiss Edge’s floating text-selection menu with Escape if it intercepts a shortcut. Check `edge://extensions/shortcuts` if another extension or desktop binding occupies a shortcut. Edge rejected the originally tried Alt+Shift+R binding in the test profile.
- Use **Look up selection with Tensho** in the selection context menu, including explicitly selected editable text, or enter a word in the panel.
- In **Reading-site access**, enable the current exact origin. Only then does double-click initiate automatic lookup. Dragging selects text without lookup, and automatic lookup excludes editable fields.
- To enable an embedded reading origin, enter it explicitly in the site-access form. Both the containing page and the frame origin must be enabled. Native access remains separately required for each origin.
- Retained results share a 6 MiB serialized storage budget. The least recently viewed inactive results are cleared first; revisiting one shows **Previous result cleared to free space** without a request. An article that cannot fit leaves existing content intact and offers its source link. If Edge does not restore sidebar visibility after switching tabs, reopen it explicitly.
- **Close lookup** or Escape inside the panel closes the native sidebar and returns focus to the source. Clicking the page leaves results open. Opening on double-click may transfer focus into the sidebar under the accepted native-focus policy.

Sites are identified by scheme, hostname, and effective port. Disabling an origin removes its local enablement and native grant. Ordinary HTTP/HTTPS documents in regular windows are the supported reading surfaces. Inaccessible selections offer manual input. Private browsing, browser-internal content, local files, PDF/EPUB/OCR, and opaque or sandbox-restricted frames are outside the delivery scope.

## Validation

`npm run check` type-checks, runs behavioral tests across coordination, bounded requests, and retained Whitaker fixtures, and builds the live unpacked extension. Requests are limited to two active operations, 15 seconds per request, 30 seconds per learner action including queueing, 1 MiB of decoded analysis or article data, and 8 MiB of decoded index data. The dictionary index alone is cached persistently for 24 hours; an expired index must refresh successfully. Articles and selected words are not persistently cached. Native scripts require Python 3, `websocket-client`, Microsoft Edge, and Xvfb for isolated visible tests:

```sh
python3 tests/native/permission_scope.py
npm run build:controlled
python3 tests/native/reading_workflow.py
python3 tests/native/reading_workflow.py --passage
python3 tests/native/reading_workflow.py --desktop
python3 tests/native/reading_workflow.py --desktop --idle
python3 tests/native/permission_workflow.py --output /tmp/tensho-access
python3 tests/native/latin_workflow.py --output /tmp/tensho-latin
python3 tests/native/latin_workflow.py --passage --output /tmp/tensho-passage
python3 tests/native/latin_workflow.py --dictionary --output /tmp/tensho-dictionary
python3 tests/native/dictionary_render.py --output /tmp/tensho-dictionary-render
node scripts/build.mjs --recovery
python3 tests/native/session_workflow.py --output /tmp/tensho-session
```

The `--desktop` command uses the current X display (KDE Xwayland in the recorded run) with a disposable Edge profile. Scripts use local fixture servers and never use the user's browser profile. The reading harness uses `dist-controlled`, a separate build with a controlled adapter substituted at build time, and adds a test-only exact-origin manifest grant; it does not establish optional-prompt behavior. The runner returns nonzero if its current native acceptance checks fail. Historical evidence of the superseded opening-focus requirement is retained separately.

The reading-site optional-access runner uses `dist-controlled` on isolated Xvfb. It enables Developer mode through Edge settings, then pauses with screenshots for native context-menu and permission-prompt coordinates; inspect each image before entering its X Y coordinates. It verifies denial, exact-origin granting, browser restart, revocation, and native Escape.

The Latin runner uses the unmodified live `dist` build on isolated Xvfb and prompts for inspected native Deny/Allow button coordinates. It verifies zero guarded requests before access, after denial, and after revocation, plus one explicit live `important` lookup and retry behavior. See [recorded live evidence](docs/validation/15-latin-access.json). Retained seven-form fixtures are dated provider observations, not a claim of general linguistic accuracy.

The Latin runner’s `--dictionary` continuation verifies the live analysis → alternatives → chosen article path and dictionary-only permission revocation. The rendering runner bundles the production dictionary modules separately and feeds retained/hostile responses through them in headless Edge; it does not modify `dist` or call providers. [Dictionary acceptance](docs/validation/16-dictionary-acceptance.md) distinguishes live evidence from controlled response coverage.

The reading runner’s `--passage` continuation verifies real selection capture and native Tab/Enter word choices, failure/retry, bounds, and stale passage messages using controlled analysis. The Latin runner’s corresponding option confirms that a chosen passage word uses the live provider and retains controls after access is revoked. See [passage acceptance](docs/validation/17-passage-acceptance.md).

The session runner uses controlled provider payloads with production session storage, coordination, and sidebar UI. Its disposable profile enables Developer mode for unpacked-extension restart testing and pregrants only its temporary reading origin. It verifies actual worker termination, browser restart, retained articles and scroll, source-page position, content-script isolation, navigation clearing, and pending completion while closed. [Session acceptance](docs/validation/24-session-acceptance.md) separates this evidence from live provider checks and storage-race tests.
