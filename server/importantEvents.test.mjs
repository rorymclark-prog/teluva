import test from 'node:test';
import assert from 'node:assert/strict';
import { isImportantEvent, isMedicalFlaggedEvent } from './importantEvents.mjs';

// The client/server agreement is pinned by src/utils/importantEventsParity.test.ts
// (npm test). These are the server rule's own cases, runnable on their own.

test('the family\'s choice wins in both directions', () => {
  assert.equal(isImportantEvent({ title: 'Football practice', important: true }), true);
  assert.equal(isImportantEvent({ title: 'Dentist', important: false }), false);
});

test('a medical appointment is important without being marked', () => {
  assert.equal(isImportantEvent({ title: 'Pediatrician — Ben' }), true);
  assert.equal(isImportantEvent({ title: 'Termin', description: 'Ordination Dr. Beispiel' }), true);
  assert.equal(isImportantEvent({ title: 'Ärztin' }), true, 'a keyword that starts with an umlaut still matches');
});

test('CONTROL: an ordinary event is not', () => {
  assert.equal(isImportantEvent({ title: 'Football practice' }), false);
  assert.equal(isImportantEvent({ title: 'Enter the raffle' }), false, '"ent" is a whole word only');
  assert.equal(isImportantEvent(null), false);
});

test('a business space has no automatic rule', () => {
  assert.equal(isImportantEvent({ title: 'Dentist' }, { business: true }), false);
  assert.equal(isImportantEvent({ title: 'Tax audit', important: true }, { business: true }), true);
  assert.equal(isMedicalFlaggedEvent({ title: 'Dentist' }), true, 'CONTROL: the title is still medical');
});
