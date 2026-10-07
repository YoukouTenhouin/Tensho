import { t } from './i18n.ts';
import type { MessageId } from '../i18n/messages.ts';
const labels: Record<string, MessageId> = {
  term: 'grammar_term', lang: 'grammar_lang', stem: 'grammar_stem', suff: 'grammar_suff', pofs: 'grammar_pofs',
  conj: 'grammar_conj', decl: 'grammar_decl', var: 'grammar_var', tense: 'grammar_tense', voice: 'grammar_voice',
  mood: 'grammar_mood', pers: 'grammar_pers', num: 'grammar_num', gend: 'grammar_gend', case: 'grammar_case', comp: 'grammar_comp',
};
/** Label supplied fields without translating their values or inferring grammar. */
export function describeGrammar(value: Record<string, unknown>, depth = 0): string {
  if (depth > 32) return '';
  return Object.entries(value).flatMap(([name, supplied]) => {
    const label = labels[name] ? t(labels[name]) : name;
    if (typeof supplied === 'string' && supplied) return [`${label}: ${supplied}`];
    if (supplied && typeof supplied === 'object' && !Array.isArray(supplied)) {
      const record = supplied as Record<string, unknown>;
      const text = typeof record.$ === 'string' ? record.$ : describeGrammar(record, depth + 1);
      return text ? [`${label}: ${text}`] : [];
    }
    return [];
  }).join(', ');
}
