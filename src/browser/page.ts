// Runs in an isolated world. Only selection and focus cross this boundary.
(() => {
  const marker = '__tenshoPageInstalled';
  const local = globalThis as typeof globalThis & { [marker]?: boolean };
  if (local[marker]) return;
  local[marker] = true;
  let source: HTMLElement | null = null;
  // Native sidebar opening can remove document focus before capture arrives.
  // Keep only focus timing, never continuously capture reading text.
  const ownsFocus = () => document.hasFocus() && !(document.activeElement instanceof HTMLIFrameElement);
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
    if (message?.type === 'capture') reply({ text: capture(), focused: ownsFocus(), lastFocused, origin: globalThis.origin });
    if (message?.type === 'restore-focus') { restore(); reply({ restored: true }); }
  });
  document.addEventListener('dblclick', event => {
    if (!event.isTrusted || globalThis.origin === 'null') return;
    const target = event.composedPath().find(item => item instanceof HTMLElement);
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input,textarea,select,[role="textbox"]'))) return;
    const text = capture();
    if (text) void chrome.runtime.sendMessage({ type: 'automatic-lookup', text }).catch(() => {});
  });
})();
