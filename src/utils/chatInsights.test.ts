// Standalone assertion test for chatInsights.ts — same convention as
// funeralCover.test.ts / aiRedact.test.ts:
//   npx tsx src/utils/chatInsights.test.ts
// It exits non-zero on failure.
//
// Covers the 2026-08-15 chat-function audit finding: "expiries" — the AI's
// authoritative "what's overdue" index — silently dropped overdue care
// visits, unbooked referrals, and lapsed funeral cover, because their nudge
// keys (care-/ref-/funeral-) were never in EXPIRY_PREFIXES, and the lapsed
// funeral nudge additionally carried no `days` field so it would have failed
// the `n.days != null` gate even if the prefix had been added. A family
// asking chat "what's overdue?" got a confident, wrong "nothing is."
import assert from 'node:assert';
import { computeChatInsights } from './chatInsights';
import type { FamilyMember, InsurancePolicy } from '../types';

const daysAgoISO = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const baseMember = (overrides: Partial<FamilyMember>): FamilyMember => ({
  id: 'm1',
  name: 'Mia',
  role: 'Child',
  avatarColor: 'bg-blue-500',
  clothingSizes: {},
  documents: [],
  ...overrides,
});

// ── care- : an overdue care-schedule item must appear in expiries ─────────
{
  const member = baseMember({
    careSchedule: [
      { id: 'c1', kind: 'Dental check-up', lastVisit: daysAgoISO(400), intervalMonths: 6 },
    ],
  });
  const { expiries } = computeChatInsights({ members: [member], vehicles: [], slips: [] });
  const care = expiries.find((n) => n.key.startsWith('care-'));
  assert.ok(care, 'an overdue care-schedule item must be in "expiries", not silently dropped');
  assert.strictEqual(care!.text, "Mia's Dental check-up is overdue");
}

// ── ref- : a long-unbooked referral must appear in expiries ────────────────
{
  const member = baseMember({
    referrals: [{
      id: 'r1', kind: 'Specialist', reason: 'Right knee', status: 'open', date: daysAgoISO(100),
      fileName: 'referral.pdf', fileType: 'application/pdf', fileSize: 1000,
      storagePath: 'x', downloadUrl: 'x', addedAt: daysAgoISO(100),
    }],
  });
  const { expiries } = computeChatInsights({ members: [member], vehicles: [], slips: [] });
  const ref = expiries.find((n) => n.key.startsWith('ref-'));
  assert.ok(ref, 'a referral sitting unbooked for weeks must be in "expiries", not silently dropped');
}

// A booked/done referral, or one of the kinds that never needs booking, must
// NOT show up — the fix must not turn every referral into a nudge.
{
  const member = baseMember({
    referrals: [{
      id: 'r2', kind: 'Lab result', status: 'open', date: daysAgoISO(100),
      fileName: 'x.pdf', fileType: 'application/pdf', fileSize: 1000, storagePath: 'x', downloadUrl: 'x', addedAt: daysAgoISO(100),
    }],
  });
  const { expiries } = computeChatInsights({ members: [member], vehicles: [], slips: [] });
  assert.ok(!expiries.some((n) => n.key.startsWith('ref-')), 'a lab result has nothing to book — must not nag');
}

// ── funeral- : a lapsed funeral policy must appear in expiries ─────────────
// This is the specific gap the audit named: computeFuneralCoverNudges was
// never even being CALLED by computeChatInsights (no `insurance` input
// existed at all), so no funeral- key could ever reach "expiries" regardless
// of EXPIRY_PREFIXES. The `days: 0` on the lapsed nudge itself (see
// NeedsAttention.tsx) is what lets it pass the `n.days != null` filter.
{
  const policy: InsurancePolicy = { id: 'p1', provider: 'Avbob', type: 'Funeral cover', status: 'lapsed' };
  const { expiries } = computeChatInsights({ members: [], vehicles: [], slips: [], insurance: [policy] });
  const funeral = expiries.find((n) => n.key.startsWith('funeral-lapsed-'));
  assert.ok(funeral, 'a lapsed funeral policy must be in "expiries", not silently dropped');
  assert.strictEqual(funeral!.days, 0);
  assert.strictEqual(expiries[0].key, funeral!.key, 'lapsed cover sorts first — it is the most urgent thing on the list');
}

// insurance defaults to [] when the caller doesn't pass it (back-compat with
// every existing call site that predates this fix) — must not throw.
{
  const result = computeChatInsights({ members: [], vehicles: [], slips: [] });
  assert.deepStrictEqual(result.expiries, []);
}

// A non-funeral, non-lapsed policy must not appear at all.
{
  const policy: InsurancePolicy = { id: 'p2', provider: 'UNIQA', type: 'Home contents', status: 'active' };
  const { expiries } = computeChatInsights({ members: [], vehicles: [], slips: [], insurance: [policy] });
  assert.strictEqual(expiries.length, 0);
}

console.log('chatInsights.test.ts: all assertions passed');
