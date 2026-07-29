// Standalone assertion test for readiness.ts — no test runner is configured
// in this project (package.json has only vite/tsc scripts), so run it directly:
//   npx tsx src/utils/readiness.test.ts
// It exits non-zero on failure. Mirrors funeralCover.test.ts's convention.
import assert from 'node:assert';
import { computeReadiness, ReadinessInput } from './readiness';
import { FamilyMember, EstateRecord, InsurancePolicy, HouseholdInfo } from '../types';

const NOW = new Date(2026, 0, 1).getTime(); // 1 Jan 2026, local midnight — matches other tests' convention

function member(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: 'm1',
    name: 'Test Person',
    role: 'Parent',
    avatarColor: 'bg-blue-500',
    clothingSizes: {},
    documents: [],
    ...overrides,
  };
}

// --- Empty family: nothing on file at all ---
{
  const input: ReadinessInput = {
    members: [],
    estateRecords: [],
    insurancePolicies: [],
    household: null,
    adminCount: 1,
  };
  const result = computeReadiness(input, NOW);
  assert.strictEqual(result.score, 0);
  assert.strictEqual(result.earned, 0);
  // Only the 5 family-wide checks apply when there are no members — nothing
  // is unfairly held against a family that just hasn't added anyone yet.
  assert.strictEqual(result.max, 15 + 15 + 8 + 5 + 4);
  assert.strictEqual(result.gaps.length, 5);
  // The two heaviest, both 'critical', sort first — second-admin was pushed
  // first among equal weights, and Array#sort is stable.
  assert.strictEqual(result.gaps[0].severity, 'critical');
  assert.strictEqual(result.gaps[0].id, 'second-admin');
  assert.ok(result.gaps.some((g) => g.id === 'will-estate'));
  assert.ok(result.gaps.some((g) => g.id === 'household-utilities' && g.severity === 'minor'));
}

// --- Fully-complete family: every check satisfied → 100 ---
{
  const fullMember = member({
    id: 'adult1',
    role: 'Parent',
    emergencyContactName: 'Aunt Jo',
    emergencyContactPhone: '+43 660 1234567',
    passport: {
      passportNumber: 'X1234567',
      fullName: 'Test Person',
      issuingCountry: 'Austria',
      dateOfBirth: '1980-01-01',
      issueDate: '2020-01-01',
      expiryDate: '2030-01-01', // comfortably more than 9 months past NOW
    },
    medical: { bloodGroup: 'O+', allergies: 'None known', conditions: '' },
    documents: [{ id: 'd1', name: 'Passport scan', category: 'ID', fileType: 'image/png', fileName: 'p.png', fileSize: 100, uploadedAt: '2026-01-01' }],
  });
  const estateRecords: EstateRecord[] = [{ id: 'e1', kind: 'Will', originalLocation: 'Notary safe' }];
  const insurancePolicies: InsurancePolicy[] = [{ id: 'i1', provider: 'Allianz' }];
  const household: HouseholdInfo = {
    address: '1 Example Street, Vienna',
    utilities: [{ id: 'u1', type: 'Electricity', provider: 'Wien Energie' }],
  };
  const input: ReadinessInput = { members: [fullMember], estateRecords, insurancePolicies, household, adminCount: 2 };
  const result = computeReadiness(input, NOW);
  assert.strictEqual(result.gaps.length, 0);
  assert.strictEqual(result.earned, result.max);
  assert.strictEqual(result.score, 100);
}

// --- Partial family: a mix of adult/child, some data present, some missing ---
{
  const adult = member({
    id: 'adult2',
    role: 'Parent',
    emergencyContactName: 'Grandpa',
    emergencyContactPhone: '+27 82 555 1234',
    // No passport/ID at all, no medical info, no documents.
  });
  const child = member({
    id: 'child1',
    name: 'Kid Person',
    role: 'Child',
    medical: { bloodGroup: 'A+' },
    // Children aren't scored on the emergency-contact check.
  });
  const input: ReadinessInput = {
    members: [adult, child],
    estateRecords: [],
    insurancePolicies: [{ id: 'i1', provider: 'Allianz' }],
    household: { address: '1 Example Street' }, // no utilities
    adminCount: 1,
  };
  const result = computeReadiness(input, NOW);

  // Emergency contact was filled in for the adult, so that gap must be absent —
  // and must never be asked of the child at all.
  assert.ok(!result.gaps.some((g) => g.id === 'emergency-contact-adult2'));
  assert.ok(!result.gaps.some((g) => g.id.startsWith('emergency-contact-child1')));

  // No passport/ID for either → both get the "on file" gap...
  assert.ok(result.gaps.some((g) => g.id === 'id-on-file-adult2'));
  assert.ok(result.gaps.some((g) => g.id === 'id-on-file-child1'));
  // ...but neither gets the "expiring soon" gap, because there's nothing to
  // compare — that check must not silently count as a pass OR a fail.
  assert.ok(!result.gaps.some((g) => g.id === 'id-expiring-adult2'));
  assert.ok(!result.gaps.some((g) => g.id === 'id-expiring-child1'));

  // Family-wide gaps still present: no admin backup, no will, no household utilities.
  assert.ok(result.gaps.some((g) => g.id === 'second-admin'));
  assert.ok(result.gaps.some((g) => g.id === 'will-estate'));
  assert.ok(result.gaps.some((g) => g.id === 'household-utilities'));
  // Insurance and address WERE provided — must not appear as gaps.
  assert.ok(!result.gaps.some((g) => g.id === 'insurance'));
  assert.ok(!result.gaps.some((g) => g.id === 'household-address'));

  // Score sits strictly between the two extremes for a family that's tried but isn't done.
  assert.ok(result.score > 0 && result.score < 100);
  // Worst-first ordering: nothing 'important'/'minor' can outrank a 'critical' gap.
  const firstMinorIndex = result.gaps.findIndex((g) => g.severity === 'minor');
  const firstCriticalIndex = result.gaps.findIndex((g) => g.severity === 'critical');
  assert.ok(firstCriticalIndex < firstMinorIndex);
}

// --- Expired ID is flagged distinctly from a missing one ---
{
  const withExpired = member({
    id: 'expired1',
    role: 'Other',
    passport: {
      passportNumber: 'Y7654321',
      fullName: 'Test Person',
      issuingCountry: 'South Africa',
      dateOfBirth: '1980-01-01',
      issueDate: '2015-01-01',
      expiryDate: '2025-06-01', // before NOW (1 Jan 2026) → expired
    },
  });
  const input: ReadinessInput = {
    members: [withExpired],
    estateRecords: [],
    insurancePolicies: [],
    household: null,
    adminCount: 1,
  };
  const result = computeReadiness(input, NOW);
  assert.ok(result.gaps.some((g) => g.id === 'id-expiring-expired1'));
  assert.ok(!result.gaps.some((g) => g.id === 'id-on-file-expired1')); // it IS on file, just stale
}

console.log('readiness.test.ts: all assertions passed');
