import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DictionaryResolution } from '../src/providers/latin-index.ts';
import type { CandidateDictionary } from '../src/core/dictionary.ts';
import type { DictionaryArticle } from '../src/providers/latin-article.ts';
import { DictionaryAnnouncements } from '../src/browser/dictionary-announcements.ts';

test('provider fallback cancels queued announcements for discarded articles', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const region = { textContent: '' };
  const announcements = new DictionaryAnnouncements(region);
  announcements.update('tab:1', [], {});
  announcements.update('tab:1', [], { 0: {
    expanded: true, resolution: { status: 'loading' },
    articles: { old: { status: 'error', message: 'Old provider failed.' } },
  } });
  // Candidate-local recovery retains the generation but discards the old articles.
  announcements.update('tab:1', [], { 0: {
    expanded: true, resolution: { status: 'unavailable', message: 'Replacement provider unavailable.' }, articles: {},
  } });
  context.mock.timers.tick(300);
  assert.equal(region.textContent, 'Dictionary for candidate 1: Replacement provider unavailable.');
});

test('changing the reading selection cancels its queued dictionary speech', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const region = { textContent: '' };
  const announcements = new DictionaryAnnouncements(region);
  announcements.update('tab:1', [], {});
  announcements.update('tab:1', [], { 0: { expanded: true, resolution: { status: 'loading' }, articles: {} } });
  announcements.update('tab:2', [], {});
  context.mock.timers.tick(300);
  assert.equal(region.textContent, '');
});

test('same-headword articles have distinct announcements without internal identifiers', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const region = { textContent: '' };
  const announcements = new DictionaryAnnouncements(region);
  const resolution: DictionaryResolution = {
    status: 'alternatives', originalHeadword: 'malum', stableLemmaId: null, provenance: undefined,
    root: 'malum', automaticSelection: null, exhaustive: false,
    alternatives: ['n1', 'n2'].map(entryId => ({ dictionary: 'Lewis & Short', entryId,
      rows: [{ key: 'malum', entryId, line: 1 }], correspondence: 'unverified' })),
  };
  const candidate: CandidateDictionary = {
    expanded: true, resolution: { status: 'complete', value: resolution }, articles: {},
  };
  const article: DictionaryArticle = {
    dictionary: 'Lewis & Short', entryId: 'n1', paragraphs: ['Complete article'], attribution: [], links: [], sourceUrl: 'https://fixture.invalid/n1',
  };
  announcements.update('tab:1', [{ lemma: 'malum', stableId: null, meanings: [], interpretations: [] }], { 0: candidate });
  candidate.articles.n1 = { status: 'complete', value: article };
  announcements.update('tab:1', [{ lemma: 'malum', stableId: null, meanings: [], interpretations: [] }], { 0: candidate });
  context.mock.timers.tick(300);
  assert.equal(region.textContent, 'Dictionary for malum, malum, entry 1: Entry from Lewis & Short is ready.');
  candidate.articles.n2 = { status: 'complete', value: { ...article, entryId: 'n2' } };
  announcements.update('tab:1', [{ lemma: 'malum', stableId: null, meanings: [], interpretations: [] }], { 0: candidate });
  context.mock.timers.tick(300);
  assert.equal(region.textContent, 'Dictionary for malum, malum, entry 2: Entry from Lewis & Short is ready.');
  candidate.expanded = false;
  announcements.update('tab:1', [{ lemma: 'malum', stableId: null, meanings: [], interpretations: [] }], { 0: candidate });
  context.mock.timers.tick(300);
  assert.equal(region.textContent, 'Dictionary for malum, malum, entry 2: Entry from Lewis & Short is ready.');
});
