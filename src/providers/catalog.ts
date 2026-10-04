import type { ProviderCatalog } from '../core/configuration.ts';
import { whitaker } from './whitaker.ts';
import { latinDictionary } from './latin-index.ts';

export const providerCatalog: ProviderCatalog = {
  languages: [
    { id: 'lat', name: 'Latin', defaultExplanation: 'en' },
    { id: 'san', name: 'Sanskrit', defaultExplanation: 'en' },
  ],
  providers: [
    { id: whitaker.id, name: whitaker.name, defaultEnabled: true,
      capabilities: [{ lookupLanguage: 'lat', role: 'analysis', explanationLanguages: ['en'],
        inputNotations: ['Unicode Latin word'], structuralAnalysis: true }],
      attribution: ['Words by William Whitaker, Copyright 1993–2007; hosted by Alpheios.'],
      origins: whitaker.origins, options: {} },
    { id: latinDictionary.id, name: latinDictionary.name, defaultEnabled: true,
      capabilities: [{ lookupLanguage: 'lat', role: 'dictionary', explanationLanguages: ['en'], inputNotations: ['Latin candidate headword'] }],
      attribution: ['A Latin Dictionary — Charlton T. Lewis and Charles Short, Oxford, Clarendon Press, 1879; hosted by Alpheios.'],
      origins: latinDictionary.origins, options: {} },
  ],
};
