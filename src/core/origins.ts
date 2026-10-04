/** URL.origin normalizes default ports; native patterns must keep the effective port. */
export function readingOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    return url.origin;
  } catch { return; }
}
export function permissionPattern(value: string): string {
  const origin = readingOrigin(value);
  if (!origin) throw new Error('Only ordinary HTTP and HTTPS reading origins are supported.');
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}/*`;
}
export function automaticAllowed(top: string, frame: string, enabled: readonly string[]): boolean {
  const topOrigin = readingOrigin(top), frameOrigin = readingOrigin(frame);
  return !!topOrigin && !!frameOrigin && enabled.includes(topOrigin) && enabled.includes(frameOrigin);
}
