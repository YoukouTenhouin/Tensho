import { LookupCoordinator } from '../core/lookup.ts';
import type { Identity, LookupRequest } from '../core/lookup.ts';
import { controlledAnalyzer } from '../core/controlled.ts';
import { automaticAllowed, permissionPattern, readingOrigin } from '../core/origins.ts';

const ports = new Set<chrome.runtime.Port>();
const panelWindows = new Map<chrome.runtime.Port, number>();
let automaticOrigins: string[] = [];
const focusRequests = new Map<number, number>();
const coordinator = new LookupCoordinator(controlledAnalyzer, () => notify());
function notify(): void { for (const port of ports) { try { port.postMessage({ type: 'changed' }); } catch { ports.delete(port); } } }
const settingsReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
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
    lookupLanguage: 'lat', explanationLanguage: 'en', configuration: 'controlled-latin-en-1' };
}
function manualIdentity(tabId: number): Identity {
  return { tabId, frameId: 0, documentId: 'manual', topDocumentId: 'manual', configuration: 'controlled-latin-en-1', lookupLanguage: 'lat', explanationLanguage: 'en' };
}
async function lookup(tabId: number, frameId: number, text: string, request: LookupRequest, documentId?: string): Promise<void> {
  try {
    const identity = await source(tabId, frameId);
    if (documentId && identity.documentId !== documentId) return;
    void request.lookup(identity, text);
  } catch (error) { request.notice(manualIdentity(tabId), '', String(error)); }
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
function open(tabId: number, focus: boolean, request?: LookupRequest, windowId?: number): Promise<boolean> {
  if (!focus && windowId !== undefined && [...panelWindows.values()].includes(windowId)) return Promise.resolve(true);
  if (focus) focusRequests.set(tabId, (focusRequests.get(tabId) ?? 0) + 1);
  return chrome.sidePanel.open({ tabId }).then(async () => {
    notify();
    return true;
  }).catch(error => {
    (request ?? { notice: coordinator.notice.bind(coordinator) }).notice(coordinator.get(tabId)?.identity ?? manualIdentity(tabId), '',
      `The native panel could not open: ${String(error)}. Open Tensho from the toolbar.`);
    return false;
  });
}
async function capture(tabId: number, request: LookupRequest): Promise<void> {
  try {
    // activeTab only authorizes its native scope. Cross-origin frames still need grants.
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['page.js'] });
    const frames = await chrome.webNavigation.getAllFrames({ tabId }) ?? [];
    const captures: { frameId: number; documentId: string; text: string; focused: boolean; lastFocused: number; origin: string; expectedOrigin: string | undefined }[] = [];
    for (const frame of frames) {
      if (!readingOrigin(frame.url)) continue;
      try {
        const value = await chrome.tabs.sendMessage(tabId, { type: 'capture' }, { documentId: frame.documentId });
        if (typeof value?.text === 'string') captures.push({ ...value, frameId: frame.frameId, documentId: frame.documentId, expectedOrigin: readingOrigin(frame.url) });
      } catch { /* Inaccessible frames do not grant page access. */ }
    }
    const focused = captures.filter(value => value.focused);
    const recent = captures.filter(value => value.lastFocused > 0).sort((a, b) => b.lastFocused - a.lastFocused);
    const withText = captures.filter(value => value.text);
    const selected = focused.length === 1 ? focused[0]
      : recent.length && recent[0]!.lastFocused !== recent[1]?.lastFocused ? recent[0]
      : withText.length === 1 ? withText[0] : undefined;
    if (!selected?.text || selected.origin !== selected.expectedOrigin) throw new Error('No unambiguous accessible selection. Select text on the page, use its context menu, or enter a word here.');
    await lookup(tabId, selected.frameId, selected.text, request, selected.documentId);
  } catch { request.notice(manualIdentity(tabId), '', 'Selection is unavailable or ambiguous. Use its context menu or enter a word manually.'); }
}
async function syncScripts(): Promise<void> {
  const origins = await enabledOrigins();
  const allowed: string[] = [];
  for (const origin of origins) if (await chrome.permissions.contains({ origins: [permissionPattern(origin)] })) allowed.push(origin);
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
chrome.permissions.onAdded.addListener(queueSync);
chrome.permissions.onRemoved.addListener(() => { automaticOrigins = []; queueSync(); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.enabledOrigins) { automaticOrigins = []; queueSync(); notify(); } });
chrome.action.onClicked.addListener(tab => { if (tab.id) open(tab.id, true); });
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || tab.incognito || info.menuItemId !== 'lookup') return;
  const request = coordinator.begin(tab.id, info.frameId ?? 0);
  open(tab.id, false, request, tab.windowId);
  void lookup(tab.id, info.frameId ?? 0, info.selectionText ?? '', request);
  // Remember source focus where temporary access permits; lookup itself needs no DOM injection.
  void chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [info.frameId ?? 0] }, files: ['page.js'] })
    .then(() => chrome.tabs.sendMessage(tab.id!, { type: 'capture' }, { frameId: info.frameId ?? 0 })).catch(() => {});
});
chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab?.id || tab.incognito) return;
  if (command === 'lookup-selection') {
    const request = coordinator.begin(tab.id);
    void capture(tab.id, request);
    open(tab.id, true, request);
  } else if (command === 'focus-results') {
    // Reopening in a second native gesture is the accepted focus fallback.
    if ([...panelWindows.values()].includes(tab.windowId)) void close(tab.id, tab.windowId).catch(console.error);
    else void open(tab.id, true);
  }
});
chrome.webNavigation.onCommitted.addListener(details => {
  coordinator.navigate(details.tabId, details.frameId);
});
chrome.tabs.onRemoved.addListener(tabId => { coordinator.clear(tabId); focusRequests.delete(tabId); });
chrome.tabs.onActivated.addListener(notify);
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'panel' || port.sender?.url !== chrome.runtime.getURL('panel.html')) return;
  ports.add(port);
  port.onMessage.addListener(message => {
    if (message?.type === 'ready' && Number.isInteger(message.windowId)) panelWindows.set(port, message.windowId);
  });
  port.onDisconnect.addListener(() => { ports.delete(port); panelWindows.delete(port); });
});
async function activeTab(windowId: number): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ windowId, active: true });
  if (!tab?.id || tab.incognito) throw new Error('No regular reading tab is available.');
  return tab;
}
async function panelAction(message: Record<string, unknown>, request?: LookupRequest): Promise<unknown> {
  if (typeof message.windowId !== 'number') throw new Error('Missing reading window');
  const tab = await activeTab(message.windowId), tabId = tab.id!;
  if (message.type === 'snapshot') {
    const top = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
    return { tabId, state: coordinator.get(tabId), origin: top ? readingOrigin(top.url) : undefined,
      enabledOrigins: await enabledOrigins(), focusRequest: focusRequests.get(tabId) ?? 0 };
  }
  if (message.type === 'manual-lookup' && typeof message.text === 'string') {
    if (message.tabId !== tabId || !request) throw new Error('The reading tab changed. Submit the word again for this tab.');
    const identity = await source(tabId).catch(() => manualIdentity(tabId));
    void request.lookup(identity, message.text);
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
    void panelAction(message, request).then(reply, error => reply({ error: String(error) })); return true;
  }
  if (message.type === 'automatic-lookup' && typeof message.text === 'string' && sender.tab?.id && !sender.tab.incognito && sender.documentId) {
    if (!sender.origin || sender.origin !== readingOrigin(sender.url ?? '')) return;
    const tabId = sender.tab.id, frameId = sender.frameId ?? 0;
    // The native gesture must reach sidePanel.open before asynchronous API calls.
    // Only already enabled/granted origins qualify; revocation invalidates this cache.
    if (!automaticAllowed(sender.tab.url ?? '', sender.url ?? '', automaticOrigins)) return;
    const request = coordinator.begin(tabId, frameId);
    const opening = open(tabId, false, request, sender.tab.windowId);
    void (async () => {
      const [top, frame, enabled] = await Promise.all([
        chrome.webNavigation.getFrame({ tabId, frameId: 0 }), chrome.webNavigation.getFrame({ tabId, frameId }), enabledOrigins(),
      ]);
      if (!top || !frame || frame.documentId !== sender.documentId || !automaticAllowed(top.url, frame.url, enabled)) return;
      if (!await chrome.permissions.contains({ origins: [permissionPattern(top.url), permissionPattern(frame.url)] })) return;
      if (!await opening) return;
      await lookup(tabId, frameId, message.text, request, sender.documentId);
    })().then(() => reply({ ok: true }), error => reply({ error: String(error) })); return true;
  }
});

queueSync();
