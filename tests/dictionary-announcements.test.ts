import { test } from 'node:test';
import assert from 'node:assert/strict';
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
