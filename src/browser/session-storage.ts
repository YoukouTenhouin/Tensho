import { readingSessionKey, SessionQuotaError } from '../core/session-results.ts';
import type { SessionStorage } from '../core/session-results.ts';

interface BrowserSessionArea {
  setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
}

/** The browser owns the session lifetime. Restrict access before any reading
 * data is read or written; only this key belongs to the reading-result budget. */
export function readingSessionStorage(area: BrowserSessionArea = chrome.storage.session): SessionStorage {
  let access: Promise<void> | undefined;
  const ready = () => access ??= area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  return {
    async read() {
      await ready();
      return (await area.get(readingSessionKey))[readingSessionKey];
    },
    async write(value) {
      await ready();
      try { await area.set({ [readingSessionKey]: value }); }
      catch (error) {
        // Chromium rejects the promise with a quota message, not a dedicated
        // exception class. Other failures must never trigger destructive eviction.
        if (error instanceof Error && /(?:QUOTA_BYTES|quota.*exceed|exceed.*quota)/i.test(error.message)) {
          throw new SessionQuotaError(error.message, { cause: error });
        }
        throw error;
      }
    },
  };
}
