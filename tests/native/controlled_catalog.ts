// Controlled native analysis has no hosted backend and needs no network grant.
// Keep the real dictionary declaration; this file is never bundled into dist.
import { providerCatalog as production } from '../../src/providers/catalog.ts';
export const providerCatalog = { ...production, providers: production.providers.map(provider =>
  provider.id === 'alpheios-whitakerLat' ? { ...provider, origins: [] } : provider) };
