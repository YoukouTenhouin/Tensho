import { message, readInterfaceLanguage, UiError } from './messages.ts';
import type { InterfaceLanguage } from './messages.ts';

export interface InterfacePreferenceStorage { read(): Promise<unknown>; write(value: InterfaceLanguage): Promise<void>; }
/** Independent of lookup settings: writes never change a lookup's identity. */
export class InterfacePreference {
  #storage: InterfacePreferenceStorage;
  #current: InterfaceLanguage = 'auto';
  #ready: Promise<void>;
  #tail: Promise<unknown> = Promise.resolve();
  constructor(storage: InterfacePreferenceStorage) {
    this.#storage = storage;
    this.#ready = storage.read().then(value => { this.#current = readInterfaceLanguage(value); });
  }
  async get(): Promise<InterfaceLanguage> { await this.#ready; return this.#current; }
  save(value: unknown): Promise<InterfaceLanguage> {
    const operation = this.#tail.then(async () => {
      await this.#ready;
      if (value !== 'auto' && value !== 'en' && value !== 'zh-Hans') throw new UiError(message('invalidInterfaceLanguage'));
      if (value !== this.#current) { await this.#storage.write(value); this.#current = value; }
      return this.#current;
    });
    this.#tail = operation.catch(() => {});
    return operation;
  }
}
