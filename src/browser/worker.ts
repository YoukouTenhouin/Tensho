import { errorMessage, message as uiMessage, resolveInterfaceLocale, translate, UiError } from '../i18n/messages.ts';
import { InterfacePreference } from '../i18n/preference.ts';
import { LookupCoordinator, sameIdentity } from '../core/lookup.ts';
import type { Identity, LookupRequest } from '../core/lookup.ts';
import { RequestExecutor } from '../core/requests.ts';
import { latinProviderOrigins } from '../providers/whitaker.ts';
import { automaticAllowed, permissionPattern, readingOrigin } from '../core/origins.ts';
import { DictionaryCoordinator } from '../core/dictionary.ts';
import { createIntegratedProviders } from '../providers/integrated.ts';
import { ConfigurationStore, lookupRoutes } from '../core/configuration.ts';
import type { Settings } from '../core/configuration.ts';
import { providerCatalog } from '../providers/catalog.ts';
import { ProviderRouter } from '../core/provider-router.ts';
import { SessionResults } from '../core/session-results.ts';
import { isReadingRecord } from '../core/reading-record.ts';
import { ReadingSession } from '../core/reading-session.ts';
import { readingSessionStorage } from './session-storage.ts';

const panelWindows = new Map<chrome.runtime.Port, number>();
let automaticOrigins: string[] = [];
let readingAccessRevision = 0;
const automaticGestures = new Map<number, symbol>();
const focusRequests = new Map<number, number>();
const settingsReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const configuration = new ConfigurationStore(providerCatalog, {
  read: async () => { await settingsReady; return (await chrome.storage.local.get('lookupSettings')).lookupSettings; },
  write: async value => { await settingsReady; await chrome.storage.local.set({ lookupSettings: value }); },
});
const interfacePreference = new InterfacePreference({
  read: async () => { await settingsReady; return (await chrome.storage.local.get('interfaceLanguage')).interfaceLanguage; },
  write: async value => { await settingsReady; await chrome.storage.local.set({ interfaceLanguage: value }); },
});
async function interfaceSnapshot() {
  const interfaceLanguage = await interfacePreference.get();
  return { interfaceLanguage, interfaceLocale: resolveInterfaceLocale(interfaceLanguage, chrome.i18n.getUILanguage()) };
}
let interfaceSync = Promise.resolve();
function syncInterface(): void {
  interfaceSync = interfaceSync.then(async () => {
    const { interfaceLocale: locale } = await interfaceSnapshot();
    const brand = translate(locale, uiMessage('brand'));
    await chrome.action.setTitle({ title: translate(locale, uiMessage('openExtension', { brand })) });
    const title = translate(locale, uiMessage('contextLookup', { brand }));
    try { await chrome.contextMenus.update('lookup', { title }); }
    catch { chrome.contextMenus.create({ id: 'lookup', title, contexts: ['selection'] }); }
  }).catch(console.error);
}
function configurationIdentity(settings: Settings) {
  return { configuration: settings.revision, lookupLanguage: settings.lookupLanguage,
    explanationLanguage: settings.languages[settings.lookupLanguage]!.explanationLanguage };
}
const executor = new RequestExecutor();
async function sourceIsCurrent(identity: Identity): Promise<boolean> {
  const configured = configurationIdentity(await configuration.get());
  if (identity.configuration !== configured.configuration || identity.lookupLanguage !== configured.lookupLanguage ||
    identity.explanationLanguage !== configured.explanationLanguage) return false;
  if (identity.documentId === 'manual') return identity.topDocumentId === (await manualIdentity(identity.tabId)).topDocumentId;
  const current = await source(identity.tabId, identity.frameId).catch(() => undefined);
  return current?.documentId === identity.documentId && current.topDocumentId === identity.topDocumentId;
}
const integrated = createIntegratedProviders({ executor,
  permitted: origins => chrome.permissions.contains({ origins: [...origins] }), fetch: globalThis.fetch.bind(globalThis),
  storage: {
    read: async () => { await settingsReady; return (await chrome.storage.local.get('latinDictionaryIndex')).latinDictionaryIndex; },
    write: async value => { await settingsReady; await chrome.storage.local.set({ latinDictionaryIndex: value }); },
  },
});
const router = new ProviderRouter({ catalog: providerCatalog, settings: () => configuration.get(),
  permitted: origins => chrome.permissions.contains({ origins: [...origins] }),
  ...integrated });
let reading: ReadingSession | undefined;
function readingChanged(tabId: number): void { reading?.changed(tabId); notify(); }
const coordinator = new LookupCoordinator(router, (_state, tabId) => readingChanged(tabId), sourceIsCurrent,
  (tabId, preserve) => preserve ? dictionaries.suspend(tabId) : dictionaries.invalidate(tabId),
  (identity, current) => reading!.prepareLookup(identity.tabId, current));
const dictionaries = new DictionaryCoordinator(router, tabId => coordinator.get(tabId), readingChanged, sourceIsCurrent);
reading = new ReadingSession({ lookup: coordinator, dictionaries, storage: new SessionResults(readingSessionStorage(), isReadingRecord),
  current: sourceIsCurrent, activeTabs: async () => (await chrome.tabs.query({ active: true })).flatMap(tab => tab.id === undefined ? [] : [tab.id]), notify });
function notify(): void { void chrome.runtime.sendMessage({ type: 'changed' }).catch(() => {}); }
async function enabledOrigins(): Promise<string[]> {
  await settingsReady;
  const { enabledOrigins: origins } = await chrome.storage.local.get('enabledOrigins');
  return Array.isArray(origins) ? origins.filter((x): x is string => typeof x === 'string' && readingOrigin(x) === x) : [];
}
async function source(tabId: number, frameId = 0): Promise<Identity> {
  const [tab, top, frame] = await Promise.all([
    chrome.tabs.get(tabId), chrome.webNavigation.getFrame({ tabId, frameId: 0 }), chrome.webNavigation.getFrame({ tabId, frameId }),
  ]);
  if (tab.incognito || !top || !frame || !readingOrigin(top.url) || !readingOrigin(frame.url) || frame.frameType === 'fenced_frame') {
    throw new UiError(uiMessage('selectionUnavailable'));
  }
  return { tabId, frameId, documentId: frame.documentId, topDocumentId: top.documentId,
    ...configurationIdentity(await configuration.get()) };
}
async function manualIdentity(tabId: number): Promise<Identity> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.incognito) throw new UiError(uiMessage('noReadingTab'));
  const top = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
  return { tabId, frameId: 0, documentId: 'manual', topDocumentId: top?.documentId ?? `restricted:${tab.url ?? ''}`,
    ...configurationIdentity(await configuration.get()) };
}
async function lookup(tabId: number, frameId: number, text: string, request: LookupRequest, documentId?: string): Promise<void> {
  try {
    const identity = await source(tabId, frameId);
    if (documentId && identity.documentId !== documentId) return;
    void request.lookup(identity, text);
  } catch (error) { request.notice(await manualIdentity(tabId), '', String(error), errorMessage(error)); }
}
async function restoreFocus(tabId: number): Promise<void> {
  const identity = coordinator.get(tabId)?.identity;
  const frameId = identity?.frameId ?? 0;
  try {
    if (identity && (await source(tabId, frameId)).documentId !== identity.documentId) throw new Error('Document changed');
    await chrome.tabs.sendMessage(tabId, { type: 'restore-focus' }, { frameId });
  } catch {
    try { await chrome.tabs.update(tabId, { active: true }); } catch { /* Source tab was closed. */ }
  }
}
async function close(tabId: number, windowId: number): Promise<void> {
  await chrome.sidePanel.close({ windowId });
  for (const [port, panelWindow] of panelWindows) if (panelWindow === windowId) panelWindows.delete(port);
  await restoreFocus(tabId);
}
function toggle(tabId: number, windowId: number): void {
  // Probe existing receivers before opening creates a new panel context.
  // Opening must run synchronously in the native command gesture; replies do not
  // retain that privilege. If a panel already existed, finish by closing it.
  const existing = new Promise<boolean>(resolve => {
    chrome.runtime.sendMessage({ type: 'panel-present', windowId }, present => {
      void chrome.runtime.lastError; // No receiver means this window has no panel.
      resolve(present === true);
    });
  });
  const opening = open(tabId, true);
  void existing.then(async present => { if (present) { await opening; await close(tabId, windowId); } }).catch(console.error);
}

function open(tabId: number, focus: boolean, request?: LookupRequest, windowId?: number): Promise<boolean> {
  if (!focus && windowId !== undefined && [...panelWindows.values()].includes(windowId)) return Promise.resolve(true);
  if (focus) focusRequests.set(tabId, (focusRequests.get(tabId) ?? 0) + 1);
  return chrome.sidePanel.open({ tabId }).then(async () => {
    notify();
    return true;
  }).catch(async error => {
    (request ?? { notice: coordinator.notice.bind(coordinator) }).notice(coordinator.get(tabId)?.identity ?? await manualIdentity(tabId), '',
      `The native panel could not open: ${String(error)}. Open Tensho from the toolbar.`, uiMessage('openFailed'));
    return false;
  });
}
async function capture(tabId: number, request: LookupRequest): Promise<void> {
  const accessRevision = readingAccessRevision;
  const current = () => {
    if (!request.current()) return false;
    if (accessRevision === readingAccessRevision) return true;
    dictionaries.resume(tabId);
    coordinator.retainAfterRefusal(tabId);
    return false;
  };
  try {
    // activeTab only authorizes its native scope. Cross-origin frames still need grants.
    const injected = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['page.js'] });
    const accessibleDocuments = new Set(injected.map(result => result.documentId));
    const frames = await chrome.webNavigation.getAllFrames({ tabId }) ?? [];
    const captures: { frameId: number; documentId: string; text: string; focused: boolean; lastFocused: number; origin: string; expectedOrigin: string | undefined; hasFocusedChild: boolean; focusedChildIndex: number; parentIndex: number }[] = [];
    for (const frame of frames) {
      if (!current()) return;
      if (!readingOrigin(frame.url) || !accessibleDocuments.has(frame.documentId)) continue;
      try {
        const value = await chrome.tabs.sendMessage(tabId, { type: 'capture' }, { documentId: frame.documentId });
        if (!current()) return;
        if (typeof value?.text === 'string') captures.push({ ...value, frameId: frame.frameId, documentId: frame.documentId, expectedOrigin: readingOrigin(frame.url) });
      } catch { /* Inaccessible frames do not grant page access. */ }
    }
    // Parent activeElement survives native sidebar focus transfer. Do not let
    // historical text in an unrelated frame stand in for an inaccessible child.
    const onFocusPath = (capture: typeof captures[number]): boolean => {
      if (capture.hasFocusedChild) return false;
      let frame = frames.find(item => item.frameId === capture.frameId);
      while (frame && frame.parentFrameId >= 0) {
        const parent = captures.find(item => item.frameId === frame!.parentFrameId);
        const child = captures.find(item => item.frameId === frame!.frameId);
        if (!parent?.hasFocusedChild || !child || child.parentIndex < 0 || parent.focusedChildIndex !== child.parentIndex) return false;
        frame = frames.find(item => item.frameId === frame!.parentFrameId);
      }
      return frame?.frameId === 0;
    };
    const focused = captures.filter(value => value.focused);
    const candidates = captures.filter(onFocusPath);
    const recent = candidates.filter(value => value.lastFocused > 0).sort((a, b) => b.lastFocused - a.lastFocused);
    const withText = candidates.filter(value => value.text);
    const selected = focused.length === 1 ? focused[0]
      : recent.length && recent[0]!.lastFocused !== recent[1]?.lastFocused ? recent[0]
      : withText.length === 1 ? withText[0] : undefined;
    if (!selected?.text || selected.origin !== selected.expectedOrigin) throw new Error('No unambiguous accessible selection. Select text on the page, use its context menu, or enter a word here.');
    await lookup(tabId, selected.frameId, selected.text, request, selected.documentId);
  } catch { request.notice(await manualIdentity(tabId), '', 'Selection is unavailable or ambiguous. Use its context menu or enter a word manually.', uiMessage('selectionAmbiguous')); }
}
async function syncScripts(): Promise<void> {
  const accessRevision = readingAccessRevision;
  const origins = await enabledOrigins();
  const allowed: string[] = [];
  for (const origin of origins) if (await chrome.permissions.contains({ origins: [permissionPattern(origin)] })) allowed.push(origin);
  if (accessRevision !== readingAccessRevision) return;
  automaticOrigins = allowed;
  const existing = await chrome.scripting.getRegisteredContentScripts();
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map(item => item.id) });
  if (allowed.length) await chrome.scripting.registerContentScripts([{ id: 'tensho-reading',
    matches: allowed.map(permissionPattern), js: ['page.js'], allFrames: true, runAt: 'document_idle', persistAcrossSessions: true }]);
  for (const tab of await chrome.tabs.query({})) {
    if (!tab.id || tab.incognito) continue;
    const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => null);
    const top = frames?.find(frame => frame.frameId === 0);
    if (!top) continue;
    for (const frame of frames ?? []) if (automaticAllowed(top.url, frame.url, allowed)) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, documentIds: [frame.documentId] }, files: ['page.js'] }).catch(() => {});
    }
  }
}
// Serialize registration changes so overlapping grants/revocations cannot race.
let scriptSync = Promise.resolve();
function queueSync(): void { scriptSync = scriptSync.then(syncScripts, syncScripts).catch(console.error); }
chrome.runtime.onInstalled.addListener(() => {
  syncInterface();
  queueSync();
});
chrome.runtime.onStartup.addListener(() => { queueSync(); syncInterface(); });
syncInterface();
chrome.permissions.onAdded.addListener(() => { queueSync(); notify(); });
chrome.permissions.onRemoved.addListener(removed => {
  readingAccessRevision++;
  executor.revokeAccess(removed.origins ?? []); automaticOrigins = []; queueSync(); notify();
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.enabledOrigins) { readingAccessRevision++; automaticOrigins = []; queueSync(); notify(); } });
chrome.action.onClicked.addListener(tab => { if (tab.id) open(tab.id, true); });
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || tab.incognito || info.menuItemId !== 'lookup') return;
  const request = coordinator.begin(tab.id, info.frameId ?? 0);
  open(tab.id, false, request, tab.windowId);
  void lookup(tab.id, info.frameId ?? 0, info.selectionText ?? '', request);
  // Remember source focus where temporary access permits; lookup itself needs no DOM injection.
  void chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [info.frameId ?? 0] }, files: ['page.js'] })
    .then(() => chrome.tabs.sendMessage(tab.id!, { type: 'remember-focus' }, { frameId: info.frameId ?? 0 })).catch(() => {});
});
chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab?.id || tab.incognito) return;
  if (command === 'lookup-selection') {
    const request = coordinator.begin(tab.id);
    void capture(tab.id, request);
    open(tab.id, true, request);
  } else if (command === 'focus-results') {
    // Reopening in a second native gesture is the accepted focus fallback.
    toggle(tab.id, tab.windowId);
  }
});
chrome.webNavigation.onCommitted.addListener(details => {
  coordinator.navigate(details.tabId, details.frameId);
});
chrome.tabs.onRemoved.addListener(tabId => { coordinator.clear(tabId); focusRequests.delete(tabId); });
chrome.tabs.onActivated.addListener(({ tabId }) => { reading!.activate(tabId); notify(); });
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'panel' || port.sender?.url !== chrome.runtime.getURL('panel.html')) return;
  port.onMessage.addListener(message => {
    if (message?.type === 'ready' && Number.isInteger(message.windowId)) panelWindows.set(port, message.windowId);
  });
  port.onDisconnect.addListener(() => { panelWindows.delete(port); });
});
async function activeTab(windowId: number): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ windowId, active: true });
  if (!tab?.id || tab.incognito) throw new UiError(uiMessage('noReadingTab'));
  return tab;
}
const globalActions = new Set(['settings-snapshot', 'save-settings', 'save-preferences', 'save-interface-language', 'provider-access-result', 'save-origin']);
async function settingsSnapshot() {
  const settings = await configuration.get();
  const providerAccess = await Promise.all(latinProviderOrigins.map(origin => chrome.permissions.contains({ origins: [origin] })));
  const providerGrants = Object.fromEntries(await Promise.all(providerCatalog.providers.map(async provider =>
    [provider.id, await chrome.permissions.contains({ origins: [...provider.origins] })] as const)));
  const { latinAccessDecision } = await chrome.storage.local.get('latinAccessDecision');
  return { ...await interfaceSnapshot(), settings, catalog: providerCatalog, routes: lookupRoutes(settings, providerCatalog), providerAccess, providerGrants,
    providerAccessDecision: latinAccessDecision ?? 'never', enabledOrigins: await enabledOrigins() };
}
async function globalAction(message: Record<string, unknown>): Promise<unknown> {
  if (message.type === 'save-interface-language') {
    const interfaceLanguage = await interfacePreference.save(message.interfaceLanguage);
    syncInterface(); notify();
    return { ok: true, interfaceLanguage };
  }
  await reading!.settled();
  if (message.type === 'settings-snapshot') return settingsSnapshot();
  if (message.type === 'save-settings' || message.type === 'save-preferences') {
    if (typeof message.expectedRevision !== 'string') throw new UiError(uiMessage('reloadSettings'));
    const windows = new Set(panelWindows.values());
    const visible = await chrome.tabs.query({ active: true });
    const previous = await configuration.get();
    let draft = message.settings;
    if (message.type === 'save-preferences') {
      if (typeof message.lookupLanguage !== 'string' || !previous.languages[message.lookupLanguage] ||
          (message.explanationLanguage !== undefined && typeof message.explanationLanguage !== 'string')) {
        throw new UiError(uiMessage('chooseLanguage'));
      }
      const preferences = structuredClone(previous);
      preferences.lookupLanguage = message.lookupLanguage;
      if (typeof message.explanationLanguage === 'string') {
        preferences.languages[message.lookupLanguage]!.explanationLanguage = message.explanationLanguage;
      }
      draft = preferences;
    }
    const saved = await configuration.save(draft, message.expectedRevision);
    if (saved.revision !== previous.revision) {
      coordinator.reconfigure(configurationIdentity(saved), visible.filter(item => windows.has(item.windowId) && item.id !== undefined).map(item => item.id!));
      notify();
    }
    return { ok: true, settings: saved };
  }
  if (message.type === 'provider-access-result') {
    const granted = await chrome.permissions.contains({ origins: [...latinProviderOrigins] });
    await chrome.storage.local.set({ latinAccessDecision: granted ? 'granted' : 'denied' });
    notify();
    return { ok: true };
  }
  if (message.type === 'save-origin' && typeof message.origin === 'string') {
    const origin = readingOrigin(message.origin);
    if (!origin || origin !== message.origin) throw new UiError(uiMessage('originExact'));
    const origins = await enabledOrigins();
    if (message.enabled === true) {
      if (!await chrome.permissions.contains({ origins: [permissionPattern(origin)] })) throw new UiError(uiMessage('siteNotGranted'));
      await chrome.storage.local.set({ enabledOrigins: [...new Set([...origins, origin])] });
    } else {
      await chrome.storage.local.set({ enabledOrigins: origins.filter(item => item !== origin) });
      await chrome.permissions.remove({ origins: [permissionPattern(origin)] });
    }
    notify();
    return { ok: true };
  }
  throw new Error('Unknown settings action.');
}
async function panelAction(message: Record<string, unknown>, request?: LookupRequest, startWord?: () => LookupRequest | undefined): Promise<unknown> {
  if (typeof message.windowId !== 'number') throw new Error('Missing reading window');
  await reading!.settled();
  if (message.type === 'panel-scroll') {
    if (typeof message.tabId === 'number' && typeof message.generation === 'number' && typeof message.x === 'number' && typeof message.y === 'number') {
      const previousTab = await chrome.tabs.get(message.tabId).catch(() => undefined);
      if (previousTab?.windowId === message.windowId) reading!.scroll(message.tabId, message.generation, message.x, message.y);
    }
    return { ok: true };
  }
  const tab = await activeTab(message.windowId), tabId = tab.id!;
  if (message.type === 'snapshot') {
    const top = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
    const global = await settingsSnapshot();
    const settings = global.settings;
    if (coordinator.get(tabId)?.identity.configuration === settings.revision) void coordinator.view(tabId);
    const state = coordinator.get(tabId);
    const current = state?.identity.configuration === settings.revision;
    reading!.view(tabId);
    const origin = top ? readingOrigin(top.url) : undefined;
    const readingAccess = !!origin && global.enabledOrigins.includes(origin) && await chrome.permissions.contains({ origins: [permissionPattern(origin)] });
    return { ...reading!.information(tabId), ...global, readingAccess, tabId, state: current ? state : undefined, dictionaries: current ? dictionaries.get(tabId) : {}, origin,
      focusRequest: focusRequests.get(tabId) ?? 0 };
  }
  if (message.type === 'dictionary-resolve' || message.type === 'dictionary-retrieve' || message.type === 'dictionary-collapse') {
    if (message.tabId !== tabId || typeof message.generation !== 'number' || typeof message.candidateIndex !== 'number') {
      throw new UiError(uiMessage('resultChanged'));
    }
    if (message.type === 'dictionary-resolve') void dictionaries.resolve(tabId, message.generation, message.candidateIndex, message.retry === true);
    else if (message.type === 'dictionary-collapse') dictionaries.collapse(tabId, message.generation, message.candidateIndex);
    else if (typeof message.entryId === 'string' && typeof message.providerId === 'string') void dictionaries.retrieve(tabId, message.generation, message.candidateIndex, message.entryId, message.retry === true, message.providerId);
  }
  if (message.type === 'manual-lookup' && typeof message.text === 'string') {
    if (message.tabId !== tabId || !request) throw new UiError(uiMessage('readingTabChanged'));
    const identity = await source(tabId).catch(() => manualIdentity(tabId));
    void request.lookup(identity, message.text);
  }
  if (message.type === 'passage-word') {
    const previous = coordinator.get(tabId);
    if (message.tabId !== tabId || !previous?.passage || previous.passage.id !== message.passageId || typeof message.wordIndex !== 'number') {
      throw new UiError(uiMessage('passageChanged'));
    }
    const identity = previous.identity.documentId === 'manual' ? await manualIdentity(tabId) : await source(tabId, previous.identity.frameId);
    if (!sameIdentity(identity, previous.identity)) throw new UiError(uiMessage('passageSourceChanged'));
    const wordRequest = startWord?.();
    if (!wordRequest) return { ok: true };
    void wordRequest.selectWord(identity, previous.passage.id, message.wordIndex);
  }
  if (message.type === 'retry') {
    const previous = coordinator.get(tabId);
    if (message.tabId !== tabId || !previous || previous.status !== 'error' || previous.generation !== message.generation) {
      throw new UiError(uiMessage('lookupChanged'));
    }
    const identity = previous.identity.documentId === 'manual' ? await manualIdentity(tabId) : await source(tabId, previous.identity.frameId);
    if (coordinator.get(tabId) !== previous || identity.documentId !== previous.identity.documentId) throw new UiError(uiMessage('sourceChanged'));
    if (previous.passage?.selectedIndex !== undefined) {
      void coordinator.begin(tabId, identity.frameId).selectWord(identity, previous.passage.id, previous.passage.selectedIndex);
    } else void coordinator.lookup(identity, previous.text);
  }
  if (message.type === 'close') {
    await close(tabId, message.windowId);
  }
  return { ok: true };
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!message || typeof message !== 'object') return;
  const senderPage = sender.url?.split(/[?#]/)[0];
  const panelSender = senderPage === chrome.runtime.getURL('panel.html');
  const optionsSender = senderPage === chrome.runtime.getURL('options.html');
  if ((panelSender || optionsSender) && globalActions.has(message.type)) {
    void globalAction(message).then(reply, error => reply({ error: String(error), uiMessage: errorMessage(error) })); return true;
  }
  if (panelSender) {
    const request = message.type === 'manual-lookup' && Number.isInteger(message.tabId) && message.tabId >= 0
      ? coordinator.begin(message.tabId, 0) : undefined;
    const startWord = message.type === 'passage-word' && Number.isInteger(message.tabId) && Number.isInteger(message.passageId) && Number.isInteger(message.wordIndex)
      ? coordinator.prepareWordChoice(message.tabId, message.passageId, message.wordIndex) : undefined;
    void panelAction(message, request, startWord).then(reply, error => reply({ error: String(error), uiMessage: errorMessage(error) })); return true;
  }
  if (message.type === 'automatic-lookup' && sender.tab?.id && !sender.tab.incognito && sender.documentId) {
    if (!sender.origin || sender.origin !== readingOrigin(sender.url ?? '')) return;
    const tabId = sender.tab.id, frameId = sender.frameId ?? 0;
    // The native gesture must reach sidePanel.open before asynchronous API calls.
    // Only already enabled/granted origins qualify; revocation invalidates this cache.
    if (!automaticAllowed(sender.tab.url ?? '', sender.url ?? '', automaticOrigins)) return;
    // Reserve capture intent without aborting usable work for an empty gesture.
    const gesture = Symbol(); automaticGestures.set(tabId, gesture);
    const accessRevision = readingAccessRevision;
    const lookupCurrent = coordinator.guard(tabId);
    const current = () => automaticGestures.get(tabId) === gesture && lookupCurrent() && accessRevision === readingAccessRevision;
    const opening = open(tabId, false, undefined, sender.tab.windowId);
    void (async () => {
      const [top, frame, enabled] = await Promise.all([
        chrome.webNavigation.getFrame({ tabId, frameId: 0 }), chrome.webNavigation.getFrame({ tabId, frameId }), enabledOrigins(),
      ]);
      if (!top || !frame || frame.documentId !== sender.documentId || !automaticAllowed(top.url, frame.url, enabled)) return;
      if (!await opening) return;
      if (!await chrome.permissions.contains({ origins: [permissionPattern(top.url), permissionPattern(frame.url)] }) || !current()) return;
      const selected = await chrome.tabs.sendMessage(tabId, { type: 'capture' }, { documentId: sender.documentId });
      if (!current() || typeof selected?.text !== 'string' || !selected.text || selected.origin !== sender.origin) return;
      const request = coordinator.begin(tabId, frameId);
      await lookup(tabId, frameId, selected.text, request, sender.documentId);
    })().then(() => reply({ ok: true }), error => reply({ error: String(error), uiMessage: errorMessage(error) })).finally(() => {
      if (automaticGestures.get(tabId) === gesture) automaticGestures.delete(tabId);
    }); return true;
  }
});

queueSync();
