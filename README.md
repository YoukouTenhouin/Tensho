# Tensho Latin reading extension

Tensho is a personal-use Microsoft Edge reading extension for openSUSE Tumbleweed and KDE Plasma. This development build implements the first native interaction slice from [ticket 14](https://github.com/YoukouTenhouin/Tensho/issues/14). Responses are explicitly controlled fixtures, not real Latin analysis. It makes no provider requests.

This controlled-response slice establishes the native interaction contract; later tickets add live services and session restoration. The user-approved focus policy allows Edge to move keyboard focus into the sidebar when opening it; updates to an already-open panel preserve page focus, and Close/Escape restores it. See [native acceptance evidence](docs/validation/14-native-acceptance.md).

## Build and load

Use Node.js 24 and npm 11 (validated with Node 24.18.1 and npm 11.16.0). Dependencies are pinned in `package-lock.json`.

```sh
npm ci
npm run check
```

In Microsoft Edge 154 or newer, open `edge://extensions`, enable Developer mode, choose **Load unpacked**, and select this repository's `dist` directory. To update, rerun `npm run check` and click **Reload** for Tensho on that page. Reload reading pages so their content scripts use the new build.

The UI starts with Latin lookup and English explanations. This slice stores explicitly enabled reading origins locally; it has no real provider configuration yet. Reading state currently resides in worker memory. Bounded session restoration and interruption recovery are subsequent tickets.

## Use the development workflow

- Press **Alt+Shift+L** to look up accessible selected text. Opening the sidebar focuses results; if it is already open, use the toggle below to move focus into it. Temporary native page access does not enable automatic lookup.
- Press **Alt+Shift+K** to toggle existing results without another lookup. When closed, one press opens and focuses them; when already open, press twice to close and reopen with focus. Dismiss Edge’s floating text-selection menu with Escape if it intercepts a shortcut. Check `edge://extensions/shortcuts` if another extension or desktop binding occupies a shortcut. Edge rejected the originally tried Alt+Shift+R binding in the test profile.
- Use **Look up selection with Tensho** in the selection context menu, including explicitly selected editable text, or enter a word in the panel.
- In **Reading-site access**, enable the current exact origin. Only then does double-click initiate automatic lookup. Dragging selects text without lookup, and automatic lookup excludes editable fields.
- To enable an embedded reading origin, enter it explicitly in the site-access form. Both the containing page and the frame origin must be enabled. Native access remains separately required for each origin.
- **Close lookup** or Escape inside the panel closes the native sidebar and returns focus to the source. Clicking the page leaves results open. Opening on double-click may transfer focus into the sidebar under the accepted native-focus policy.

Sites are identified by scheme, hostname, and effective port. Disabling an origin removes its local enablement and native grant. Ordinary HTTP/HTTPS documents in regular windows are the supported reading surfaces. Inaccessible selections offer manual input. Private browsing, browser-internal content, local files, PDF/EPUB/OCR, and opaque or sandbox-restricted frames are outside the delivery scope.

## Validation

`npm run check` type-checks, runs coordinator/origin behavioral tests, and builds the unpacked extension. Native scripts require Python 3, `websocket-client`, Microsoft Edge, and Xvfb for isolated visible tests:

```sh
python3 tests/native/permission_scope.py
python3 tests/native/reading_workflow.py
python3 tests/native/reading_workflow.py --desktop
python3 tests/native/reading_workflow.py --desktop --idle
python3 tests/native/permission_workflow.py --output /tmp/tensho-access
```

The `--desktop` command uses the current X display (KDE Xwayland in the recorded run) with a disposable Edge profile. Scripts use local fixture servers and never use the user's browser profile. The reading harness adds a test-only exact-origin manifest grant; it does not establish optional-prompt behavior. The runner returns nonzero if its current native acceptance checks fail. Historical evidence of the superseded opening-focus requirement is retained separately.

The optional-access runner uses the unmodified production build on isolated Xvfb. It enables Developer mode through Edge settings, then pauses with screenshots for native context-menu and permission-prompt coordinates; inspect each image before entering its X Y coordinates. It verifies denial, exact-origin granting, browser restart, revocation, and native Escape.
