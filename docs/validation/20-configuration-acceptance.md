# Lookup configuration acceptance

Ticket [#20](https://github.com/YoukouTenhouin/Tensho/issues/20) adds persistent, explicit lookup and explanation settings with declared provider capabilities. Validation on 2026-10-04 used Node 24.18.1, npm 11.16.0, and Microsoft Edge 154.0.4258.37. All native runs used isolated Xvfb displays.

## Delivered behavior

Fresh settings select Latin with English explanations. Separate Lookup and Explanations controls edit a draft; the saved configuration remains visible above results until Save succeeds. Settings persist locally across tabs and browser restarts. Each lookup language retains its explanation preference and independently ordered analysis and dictionary providers, enablement, and declared options. Production declarations expose supported languages, roles, explanation languages, input notations, attribution, origins, and options. Only validated Latin providers ship; Sanskrit is explicitly unconfigured.

Explanation choices are the union of enabled role capabilities. Analysis selects the explanation-compatible route before execution, or a structural-only route when no compatible analyzer exists. Structural-only output retains candidate lemmas and English grammatical interpretations while omitting provider short meanings and explaining their absence. Failed or empty preferred analysis does not start a structural chain. Dictionary routing uses only explanation-compatible providers; unavailable dictionaries leave analysis intact, and eligible articles retain embedded foreign quotations.

Disabling every provider preserves the saved explanation preference as unavailable. An edit leaving some providers enabled but removing every source for the preference requires an explicitly supported replacement before saving. External capability loss preserves the preference instead of silently choosing another language. Provider URLs and request limits remain application-controlled.

A successful edit creates a new configuration revision and refreshes visible selections. Chosen passage words retain their passage; unchosen passages remain unsent. Pending work is cancelled and late responses cannot replace the new result. Inactive results retain input with an explicit refresh notice; deferred refresh and retained-result reuse remain #26. Concurrent settings edits use the revision they displayed, preventing silent overwrites. Failed storage writes leave the saved settings unchanged.

## Evidence

- `npm run check`: **72 behavioral tests pass**, plus type checking and production build. Controlled declarations exercise Latin versus English lookup for identical spelling, French-compatible analysis, structural-only analysis with a French dictionary, unavailable dictionaries, all-disabled settings, invalid replacement, independent order and options, durable saves, capability loss, and late-response isolation through production coordination and routing.
- [Native settings evidence](20-native-settings.json): **20 checks pass** through the actual sidebar. The run saves Latin/Sanskrit changes, refreshes `important`, verifies no calls for unconfigured Sanskrit or all-disabled Latin, preserves role-specific enablement, switches tabs, fully closes and restarts Edge with the same profile, and verifies exact settings restoration without an automatic lookup. Only analysis responses are controlled; configuration, routing, browser storage, and UI are production code.
- [Live Latin evidence](20-live-latin.json): **13 checks pass** with the unmodified production extension. Native permission denial and grant are exercised. One explicit `important` request reaches Whitaker with `lang=lat` and returns `importo`; no English-word lookup occurs. Missing/revoked access sends no guarded request. Attribution and English short meanings remain visible.
- [Native reading and passage evidence](20-native-reading.json): **49 checks pass**, preserving selection capture, native keyboard behavior, passage choices, focus restoration, stale-action rejection, and explicit retry.
- `npm ci --offline` followed by `npm run check` reproduced all **nine production artifact hashes** exactly.

Native settings validation exposed a save-confirmation race between the returned save and background refresh notifications. The corrected callback returns the exact committed settings, preventing an obsolete editor reset; the final settings run exercises the correction. The 49-check reading run preceded this UI save correction; the final core suite and settings/live runs cover the corrected implementation.

## Standards

Independent review found **zero documented-standard violations**. An initial rendering-time catalog-reconciliation suggestion was resolved by removing that unnecessary draft mutation. One nonblocking harness-maintenance suggestion remains: the native settings runner repeats Xvfb lifecycle setup already used by other runners; a future shared helper could centralize that setup.

## Spec

Independent review through `b7b652c` found **zero unresolved spec findings**, with native save/restart evidence and live Latin routing confirmed. Multi-provider technical-failure fallback remains #23; browser-session result retention remains #24; deferred cross-tab refresh/reuse remains #26. Research tickets and functioning Sanskrit services remain out of scope.

Final review totals: Standards **0 hard violations / 1 nonblocking harness-maintenance suggestion**; Spec **0 unresolved findings**.
