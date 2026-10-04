import type { ProviderCatalog, ProviderDeclaration } from '../../src/core/configuration.ts';
function provider(id: string, role: 'analysis' | 'dictionary'): ProviderDeclaration {
  return { id, name: id, defaultEnabled: !id.endsWith('disabled'),
    capabilities: [{ lookupLanguage: 'lat', role, explanationLanguages: ['en'], inputNotations: ['Controlled Unicode'], structuralAnalysis: role === 'analysis' }],
    origins: id.endsWith('denied') ? ['https://ungranted.invalid/*'] : [], attribution: ['Controlled recovery fixture'], options: {} };
}
export const providerCatalog: ProviderCatalog = {
  languages: [{ id: 'lat', name: 'Latin', defaultExplanation: 'en' }],
  providers: ['a-disabled', 'a-denied', 'a-first', 'a-second'].map(id => provider(id, 'analysis'))
    .concat(['d-disabled', 'd-denied', 'd-first', 'd-second', 'd-third'].map(id => provider(id, 'dictionary'))),
};
