# Tensho Latin reading extension

Tensho is a personal-use Microsoft Edge reading extension for openSUSE Tumbleweed and KDE Plasma. This development build implements the first native interaction slice from [ticket 14](https://github.com/YoukouTenhouin/Tensho/issues/14). Responses are explicitly controlled fixtures, not real Latin analysis. It makes no provider requests.

The slice is not accepted for release: opening Edge's native sidebar after double-click moves keyboard focus off the reading page. The approved specification requires page-focus preservation or an explicit design revision. See [native acceptance evidence](docs/validation/14-native-acceptance.md).

## Build and load

Use Node.js 24 and npm 11 (validated with Node 24.18.1 and npm 11.16.0). Dependencies are pinned in `package-lock.json`.

```sh
npm ci
npm run check
```

In Microsoft Edge 154 or newer, open `edge://extensions`, enable Developer mode, choose **Load unpacked**, and select this repository's `dist` directory. To update, rerun `npm run check` and click **Reload** for Tensho on that page. Reload reading pages so their content scripts use the new build.

The UI starts with Latin lookup and English explanations. This slice stores explicitly enabled reading origins locally; it has no real provider configuration yet. Reading state currently resides in worker memory. Bounded session restoration and interruption recovery are subsequent tickets.

## Use the development workflow

- Press **Alt+Shift+L** to look up accessible selected text and focus the results. Temporary native page access does not enable automatic lookup.
- Press **Alt+Shift+K** to open/focus existing results without another lookup. Check `edge://extensions/shortcuts` if another extension or desktop binding occupies a shortcut. Edge rejected the originally tried Alt+Shift+R binding in the test profile.
- Use **Look up selection with Tensho** in the selection context menu, including explicitly selected editable text, or enter a word in the panel.
- In **Reading-site access**, enable the current exact origin. Only then does double-click initiate automatic lookup. Dragging selects text without lookup, and automatic lookup excludes editable fields.
- To enable an embedded reading origin, enter it explicitly in the site-access form. Both the containing page and the frame origin must be enabled. Native access remains separately required for each origin.
- **Close lookup** or Escape inside the panel closes the native sidebar and returns focus to the source. Clicking the page leaves results open. Opening on double-click currently has the focus limitation described above.

Sites are identified by scheme, hostname, and effective port. Disabling an origin removes its local enablement and native grant. Ordinary HTTP/HTTPS documents in regular windows are the supported reading surfaces. Inaccessible selections offer manual input. Private browsing, browser-internal content, local files, PDF/EPUB/OCR, and opaque or sandbox-restricted frames are outside the delivery scope.

## Validation

`npm run check` type-checks, runs coordinator/origin behavioral tests, and builds the unpacked extension. Native scripts require Python 3, `websocket-client`, Microsoft Edge, and Xvfb for isolated visible tests:

```sh
python3 tests/native/permission_scope.py
python3 tests/native/reading_workflow.py
python3 tests/native/reading_workflow.py --desktop
```

The last command uses the current X display (KDE Xwayland in the recorded run) with a disposable Edge profile. Scripts use local fixture servers and never use the user's browser profile. The reading harness adds a test-only exact-origin manifest grant; it does not establish optional-prompt behavior. Its nonzero exit currently records the failing double-click focus requirement, rather than treating that failure as an accepted exception.
