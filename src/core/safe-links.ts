/** Reject controls/whitespace before URL parsing can silently repair them. */
export function safeHttpsUrl(value: string, base?: string): string | undefined {
  if (!value || /[\u0000-\u0020\u007f]/u.test(value)) return;
  try {
    const url = base === undefined ? new URL(value) : new URL(value, base);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return;
    return url.href;
  } catch { return; }
}
