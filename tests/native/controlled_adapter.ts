// Build-time adapter substitution for native reading tests; never bundled into dist.
import { controlledAnalyzer } from '../../src/core/controlled.ts';
import type { createWhitakerAnalyzer as productionFactory } from '../../src/providers/whitaker.ts';
export { latinProviderOrigins } from '../../src/providers/whitaker.ts';
export const createWhitakerAnalyzer: typeof productionFactory = () => controlledAnalyzer;
