// Runs in an isolated world. Only selection and focus cross this boundary.
(() => {
  const marker = '__tenshoPageInstalled';
  const local = globalThis as typeof globalThis & { [marker]?: boolean };
  if (local[marker]) return;
  local[marker] = true;
  let source: HTMLElement | null = null;
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
    if (message?.type === 'capture') reply({ text: capture(), focused: document.hasFocus() });
    if (message?.type === 'restore-focus') { restore(); reply({ restored: true }); }
  });
  document.addEventListener('dblclick', event => {
    if (!event.isTrusted) return;
    const target = event.composedPath().find(item => item instanceof HTMLElement);
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input,textarea,select,[role="textbox"]'))) return;
    const text = capture();
    if (text) void chrome.runtime.sendMessage({ type: 'automatic-lookup', text }).catch(() => {});
  });
})();
