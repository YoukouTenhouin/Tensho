import type { Analyzer } from '../core/lookup.ts';
import { createWhitakerAnalyzer } from './whitaker.ts';
import { createLatinDictionary } from './latin-dictionary.ts';
import type { DictionaryProvider } from './latin-dictionary.ts';

/** The shipping adapter registry contains validated integrations only. */
export function createIntegratedProviders(dependencies: Parameters<typeof createLatinDictionary>[0]): {
  analyzers: Record<string, Analyzer>; dictionaries: Record<string, DictionaryProvider>;
} {
  return { analyzers: { 'alpheios-whitakerLat': createWhitakerAnalyzer(dependencies) },
    dictionaries: { 'alpheios-ls': createLatinDictionary(dependencies) } };
}
