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
    throw new Error('Selection is unavailable on this surface. Use an ordinary HTTP/HTTPS page, or enter a word manually.');
  }
  return { tabId, frameId, documentId: frame.documentId, topDocumentId: top.documentId,
    ...configurationIdentity(await configuration.get()) };
}
async function manualIdentity(tabId: number): Promise<Identity> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.incognito) throw new Error('No regular reading tab is available.');
  const top = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
  return { tabId, frameId: 0, documentId: 'manual', topDocumentId: top?.documentId ?? `restricted:${tab.url ?? ''}`,
    ...configurationIdentity(await configuration.get()) };
}
async function lookup(tabId: number, frameId: number, text: string, request: LookupRequest, documentId?: string): Promise<void> {
  try {
    const identity = await source(tabId, frameId);
    if (documentId && identity.documentId !== documentId) return;
    void request.lookup(identity, text);
  } catch (error) { request.notice(await manualIdentity(tabId), '', String(error)); }
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
      `The native panel could not open: ${String(error)}. Open Tensho from the toolbar.`);
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
  } catch { request.notice(await manualIdentity(tabId), '', 'Selection is unavailable or ambiguous. Use its context menu or enter a word manually.'); }
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
  chrome.contextMenus.create({ id: 'lookup', title: 'Look up selection with Tensho', contexts: ['selection'] });
  queueSync();
});
chrome.runtime.onStartup.addListener(queueSync);
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
  if (!tab?.id || tab.incognito) throw new Error('No regular reading tab is available.');
  return tab;
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
    const providerAccess = await Promise.all(latinProviderOrigins.map(origin => chrome.permissions.contains({ origins: [origin] })));
    const { latinAccessDecision } = await chrome.storage.local.get('latinAccessDecision');
    const settings = await configuration.get();
    const state = coordinator.get(tabId);
    const current = state?.identity.configuration === settings.revision;
    reading!.view(tabId);
    return { ...reading!.information(tabId), settings, catalog: providerCatalog, routes: lookupRoutes(settings, providerCatalog), tabId, state: current ? state : undefined, dictionaries: current ? dictionaries.get(tabId) : {}, providerAccess,
      providerAccessDecision: latinAccessDecision ?? 'never', origin: top ? readingOrigin(top.url) : undefined,
      enabledOrigins: await enabledOrigins(), focusRequest: focusRequests.get(tabId) ?? 0 };
  }
  if (message.type === 'save-settings') {
    if (message.tabId !== tabId || typeof message.expectedRevision !== 'string') throw new Error('The reading tab changed. Reload settings before saving.');
    const windows = new Set(panelWindows.values());
    windows.add(message.windowId);
    const visible = await chrome.tabs.query({ active: true });
    const previous = await configuration.get();
    const saved = await configuration.save(message.settings, message.expectedRevision);
    if (saved.revision !== previous.revision) {
      coordinator.reconfigure(configurationIdentity(saved), visible.filter(item => windows.has(item.windowId) && item.id !== undefined).map(item => item.id!));
      notify();
    }
    return { ok: true, settings: saved };
  }
  if (message.type === 'dictionary-resolve' || message.type === 'dictionary-retrieve' || message.type === 'dictionary-collapse') {
    if (message.tabId !== tabId || typeof message.generation !== 'number' || typeof message.candidateIndex !== 'number') {
      throw new Error('The reading result changed. Open the current candidate again.');
    }
    if (message.type === 'dictionary-resolve') void dictionaries.resolve(tabId, message.generation, message.candidateIndex, message.retry === true);
    else if (message.type === 'dictionary-collapse') dictionaries.collapse(tabId, message.generation, message.candidateIndex);
    else if (typeof message.entryId === 'string' && typeof message.providerId === 'string') void dictionaries.retrieve(tabId, message.generation, message.candidateIndex, message.entryId, message.retry === true, message.providerId);
  }
  if (message.type === 'manual-lookup' && typeof message.text === 'string') {
    if (message.tabId !== tabId || !request) throw new Error('The reading tab changed. Submit the word again for this tab.');
    const identity = await source(tabId).catch(() => manualIdentity(tabId));
    void request.lookup(identity, message.text);
  }
  if (message.type === 'passage-word') {
    const previous = coordinator.get(tabId);
    if (message.tabId !== tabId || !previous?.passage || previous.passage.id !== message.passageId || typeof message.wordIndex !== 'number') {
      throw new Error('The passage changed. Choose a word from the current passage.');
    }
    const identity = previous.identity.documentId === 'manual' ? await manualIdentity(tabId) : await source(tabId, previous.identity.frameId);
    if (!sameIdentity(identity, previous.identity)) throw new Error('The passage source changed. Select the passage again.');
    const wordRequest = startWord?.();
    if (!wordRequest) return { ok: true };
    void wordRequest.selectWord(identity, previous.passage.id, message.wordIndex);
  }
  if (message.type === 'provider-access-result') {
    const granted = await chrome.permissions.contains({ origins: [...latinProviderOrigins] });
    await chrome.storage.local.set({ latinAccessDecision: granted ? 'granted' : 'denied' });
    notify();
  }
  if (message.type === 'retry') {
    const previous = coordinator.get(tabId);
    if (message.tabId !== tabId || !previous || previous.status !== 'error' || previous.generation !== message.generation) {
      throw new Error('The lookup changed. Select the word again.');
    }
    const identity = previous.identity.documentId === 'manual' ? await manualIdentity(tabId) : await source(tabId, previous.identity.frameId);
    if (coordinator.get(tabId) !== previous || identity.documentId !== previous.identity.documentId) throw new Error('The reading source changed. Select the word again.');
    if (previous.passage?.selectedIndex !== undefined) {
      void coordinator.begin(tabId, identity.frameId).selectWord(identity, previous.passage.id, previous.passage.selectedIndex);
    } else void coordinator.lookup(identity, previous.text);
  }
  if (message.type === 'save-origin' && typeof message.origin === 'string') {
    const origin = readingOrigin(message.origin);
    if (!origin || origin !== message.origin) throw new Error('Enter an exact HTTP/HTTPS origin.');
    const origins = await enabledOrigins();
    if (message.enabled === true) {
      if (!await chrome.permissions.contains({ origins: [permissionPattern(origin)] })) throw new Error('Site access was not granted.');
      await chrome.storage.local.set({ enabledOrigins: [...new Set([...origins, origin])] });
    } else {
      await chrome.storage.local.set({ enabledOrigins: origins.filter(item => item !== origin) });
      await chrome.permissions.remove({ origins: [permissionPattern(origin)] });
    }
  }
  if (message.type === 'close') {
    await close(tabId, message.windowId);
  }
  return { ok: true };
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!message || typeof message !== 'object') return;
  if (sender.url === chrome.runtime.getURL('panel.html')) {
    const request = message.type === 'manual-lookup' && Number.isInteger(message.tabId) && message.tabId >= 0
      ? coordinator.begin(message.tabId, 0) : undefined;
    const startWord = message.type === 'passage-word' && Number.isInteger(message.tabId) && Number.isInteger(message.passageId) && Number.isInteger(message.wordIndex)
      ? coordinator.prepareWordChoice(message.tabId, message.passageId, message.wordIndex) : undefined;
    void panelAction(message, request, startWord).then(reply, error => reply({ error: String(error) })); return true;
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
    })().then(() => reply({ ok: true }), error => reply({ error: String(error) })).finally(() => {
      if (automaticGestures.get(tabId) === gesture) automaticGestures.delete(tabId);
    }); return true;
  }
});

queueSync();
