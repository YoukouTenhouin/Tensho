import type { createIntegratedProviders as production } from '../../src/providers/integrated.ts';
import { createLatinDictionary } from '../../src/providers/latin-dictionary.ts';
import { createWhitakerAnalyzer } from './controlled_adapter.ts';
export const createIntegratedProviders: typeof production = dependencies => ({
  analyzers: { 'alpheios-whitakerLat': createWhitakerAnalyzer(dependencies) },
  dictionaries: { 'alpheios-ls': createLatinDictionary(dependencies) },
});
