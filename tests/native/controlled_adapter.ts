// Build-time adapter substitution for native reading tests; never bundled into dist.
import { controlledAnalyzer } from '../../src/core/controlled.ts';
import type { createWhitakerAnalyzer as productionFactory } from '../../src/providers/whitaker.ts';
export { latinProviderOrigins } from '../../src/providers/whitaker.ts';
export const createWhitakerAnalyzer: typeof productionFactory = () => ({
  async analyze(...args) {
    const scope = globalThis as typeof globalThis & { __tenshoControlledCalls?: string[]; __tenshoControlledDelay?: number };
    (scope.__tenshoControlledCalls ??= []).push(args[0]);
    if (scope.__tenshoControlledDelay) await new Promise<void>(resolve => setTimeout(resolve, scope.__tenshoControlledDelay));
    if (args[0] === 'controlled-failure') throw new Error('Controlled analysis failure.');
    return controlledAnalyzer.analyze(...args);
  },
});
