// Runs in an isolated world. Only selection and focus cross this boundary.
(() => {
  const marker = '__tenshoPageInstalled';
  const local = globalThis as typeof globalThis & { [marker]?: boolean };
  if (local[marker]) return;
  local[marker] = true;
  let source: HTMLElement | null = null;
  // Native sidebar opening can remove document focus before capture arrives.
  // Keep only focus timing, never continuously capture reading text.
  const focusedChild = () => document.activeElement instanceof HTMLIFrameElement || document.activeElement instanceof HTMLFrameElement ? document.activeElement : null;
  const ownsFocus = () => document.hasFocus() && !focusedChild();
  function childIndex(parentWindow: Window, child: Window | null): number {
    for (let index = 0; index < parentWindow.length; index++) if (parentWindow[index] === child) return index;
    return -1;
  }
  let lastFocused = ownsFocus() ? performance.timeOrigin + performance.now() : 0;
  const rememberFocus = () => { if (ownsFocus()) lastFocused = performance.timeOrigin + performance.now(); };
  window.addEventListener('focus', rememberFocus, true);
  document.addEventListener('pointerdown', event => { if (event.isTrusted) rememberFocus(); }, true);
  document.addEventListener('keydown', event => { if (event.isTrusted) rememberFocus(); }, true);

  function capture(): string {
    source = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (source instanceof HTMLInputElement || source instanceof HTMLTextAreaElement) {
      return source.value.slice(source.selectionStart ?? 0, source.selectionEnd ?? 0);
    }
    return getSelection()?.toString() ?? '';
  }
  function restore(): void {
    window.focus();
    if (source?.isConnected) source.focus({ preventScroll: true });
    else document.body.focus({ preventScroll: true });
  }
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type === 'capture') {
      const child = focusedChild();
      reply({ text: capture(), focused: ownsFocus(), lastFocused,
        hasFocusedChild: child !== null, focusedChildIndex: childIndex(window, child?.contentWindow ?? null),
        parentIndex: window === window.parent ? -1 : childIndex(window.parent, window), origin: globalThis.origin });
    }
    if (message?.type === 'restore-focus') { restore(); reply({ restored: true }); }
  });
  document.addEventListener('dblclick', event => {
    if (!event.isTrusted || globalThis.origin === 'null') return;
    const target = event.composedPath().find(item => item instanceof HTMLElement);
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input,textarea,select,[role="textbox"]'))) return;
    // Previously injected scripts survive permission removal. Send only the
    // gesture; the worker must authorize this document before asking for text.
    void chrome.runtime.sendMessage({ type: 'automatic-lookup' }).catch(() => {});
  });
})();
