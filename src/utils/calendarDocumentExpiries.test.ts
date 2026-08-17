// Standalone assertion test for calendarDocumentExpiries.ts. The calendar's
// document watch is safety-sensitive: it must read live member fields, use the
// same nine-month warning boundary as readiness, and never depend on a stray
// calendar event existing.
import assert from 'node:assert';
import type { FamilyMember } from '../types';
import { buildCalendarDocumentExpiries, documentExpiryStatusLabel } from './calendarDocumentExpiries';

const NOW = new Date('2026-08-17T12:00:00');

function member(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: 'm1',
    name: 'Rory Example',
    role: 'Parent',
    avatarColor: 'bg-clay-500',
    clothingSizes: {},
    documents: [],
    ...overrides,
  };
}

{
  const expiries = buildCalendarDocumentExpiries([member({
    passports: [
      { id: 'p-soon', country: 'Austria', number: 'SECRET-1', expiryDate: '2027-05-01' },
      { id: 'p-later', country: 'South Africa', number: 'SECRET-2', expiryDate: '2028-01-01' },
    ],
    travel: { visas: [{ id: 'v1', country: 'United Kingdom', permitType: 'Work permit', expiryDate: '2026-11-17' }] },
    identity: { residencePermitExpiry: '2026-08-01' },
  })], NOW);

  assert.deepStrictEqual(expiries.map((e) => e.kind), [
    'Residence permit', 'Visa / permit', 'Passport', 'Passport',
  ]);
  assert.deepStrictEqual(expiries.map((e) => e.status), ['expired', 'soon', 'soon', 'later']);
  assert.strictEqual(documentExpiryStatusLabel(expiries[0]), 'Expired');
  assert.match(documentExpiryStatusLabel(expiries[1]), /^Expires in ~3 months$/);
  assert.ok(expiries.every((e) => !JSON.stringify(e).includes('SECRET-')), 'document numbers must not enter the calendar-facing result');
}

// The old single-passport field remains valid data, but must not duplicate a
// matching record already migrated into passports[].
{
  const expiries = buildCalendarDocumentExpiries([member({
    passport: {
      passportNumber: 'SAME', fullName: 'Rory Example', issuingCountry: 'Austria',
      dateOfBirth: '1980-01-01', issueDate: '2020-01-01', expiryDate: '2027-01-01',
    },
    passports: [{ id: 'new', country: 'Austria', number: 'SAME', expiryDate: '2027-01-01' }],
  })], NOW);
  assert.strictEqual(expiries.length, 1, 'a migrated legacy passport must appear only once');
}

// Malformed and missing dates are ignored rather than converted into a false
// warning; this panel is a view of known dates, not a data-completeness score.
{
  const expiries = buildCalendarDocumentExpiries([member({
    passports: [
      { id: 'bad', country: 'Austria', number: 'X', expiryDate: 'not-a-date' },
      { id: 'impossible', country: 'Austria', number: 'Y', expiryDate: '2027-02-31' },
    ],
    travel: { visas: [{ id: 'blank', country: 'UK' }] },
  })], NOW);
  assert.deepStrictEqual(expiries, []);
}

console.log('calendarDocumentExpiries.test.ts: all assertions passed.');
