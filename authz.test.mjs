// Standalone assertion tests for the membership authorization rules.
// No test runner is configured in this project (package.json has only
// vite/tsc scripts), so run it directly — same convention as
// src/utils/speechLocale.test.ts:
//   node authz.test.mjs
// It exits non-zero on failure.
import assert from 'node:assert';
import { resolveMembership, checkRemoveMember, profileAfterRemoval } from './authz.mjs';

const ADMIN = { callerUid: 'admin-1', callerRole: 'admin' };

// ── resolveMembership ───────────────────────────────────────────────────────
// THE regression test for this whole change: membership and role come from the
// roles doc, never from the users/{uid} mirror.

// A real member: mirror points at the space AND the roles doc exists.
assert.deepStrictEqual(
  resolveMembership({
    profileExists: true, profile: { familyId: 'fam-1', role: 'member' },
    roleDocExists: true, roleDoc: { role: 'member' },
  }),
  { ok: true, familyId: 'fam-1', role: 'member' },
);

// A REVOKED member: the mirror still names the space (nothing cleans it up),
// but the roles doc is gone. Must be DENIED — this is the blocker being fixed.
const revoked = resolveMembership({
  profileExists: true, profile: { familyId: 'fam-1', role: 'admin', spaces: [{ id: 'fam-1', role: 'admin' }] },
  roleDocExists: false, roleDoc: undefined,
});
assert.strictEqual(revoked.ok, false, 'a user with no roles doc must be denied');
assert.strictEqual(revoked.status, 403);

// The mirror can NEVER over-grant: a stale mirror role of 'admin' loses to the
// roles doc's 'child'.
assert.strictEqual(
  resolveMembership({
    profileExists: true, profile: { familyId: 'fam-1', role: 'admin' },
    roleDocExists: true, roleDoc: { role: 'child' },
  }).role,
  'child',
  'role must come from the roles doc, not the mirror',
);

// ...and the mirror can't under-grant either — the roles doc is simply the truth.
assert.strictEqual(
  resolveMembership({
    profileExists: true, profile: { familyId: 'fam-1', role: 'child' },
    roleDocExists: true, roleDoc: { role: 'admin' },
  }).role,
  'admin',
);

// No profile at all → the "create or join a family" path, not the revoked one.
const noProfile = resolveMembership({ profileExists: false, profile: undefined, roleDocExists: false });
assert.strictEqual(noProfile.ok, false);
assert.strictEqual(noProfile.status, 403);
assert.match(noProfile.error, /not part of a family yet/i);

// A profile with no/blank/non-string familyId is not a member of anything.
for (const familyId of [undefined, '', null, 123, {}]) {
  const r = resolveMembership({ profileExists: true, profile: { familyId }, roleDocExists: true, roleDoc: { role: 'admin' } });
  assert.strictEqual(r.ok, false, `familyId ${JSON.stringify(familyId)} must not authorize`);
  assert.strictEqual(r.status, 403);
}

// ── checkRemoveMember ───────────────────────────────────────────────────────

// Happy path: an admin removes an ordinary member.
assert.deepStrictEqual(
  checkRemoveMember({ ...ADMIN, targetUid: 'kid-1', targetIsMember: true, targetRole: 'child', adminCount: 1 }),
  { ok: true },
  'admin should be able to remove a child',
);
assert.deepStrictEqual(
  checkRemoveMember({ ...ADMIN, targetUid: 'mem-1', targetIsMember: true, targetRole: 'member', adminCount: 1 }),
  { ok: true },
  'admin should be able to remove a member',
);

// A NON-ADMIN cannot remove anyone — including another non-admin.
for (const role of ['member', 'child', undefined, 'ADMIN']) {
  const r = checkRemoveMember({
    callerUid: 'mem-1', callerRole: role,
    targetUid: 'mem-2', targetIsMember: true, targetRole: 'member', adminCount: 2,
  });
  assert.strictEqual(r.ok, false, `role ${role} must not remove members`);
  assert.strictEqual(r.status, 403);
}

// A member cannot remove an admin either (same 403 — role is checked first).
assert.strictEqual(
  checkRemoveMember({ callerUid: 'mem-1', callerRole: 'member', targetUid: 'admin-1', targetIsMember: true, targetRole: 'admin', adminCount: 1 }).status,
  403,
);

// You cannot remove YOURSELF — this is what makes the space-orphaning rule hold.
const self = checkRemoveMember({ ...ADMIN, targetUid: 'admin-1', targetIsMember: true, targetRole: 'admin', adminCount: 1 });
assert.strictEqual(self.ok, false, 'self-removal must be refused');
assert.strictEqual(self.status, 400);
assert.match(self.error, /yourself/i);

// ...even when other admins exist (self-removal is "leave", a different op).
assert.strictEqual(
  checkRemoveMember({ ...ADMIN, targetUid: 'admin-1', targetIsMember: true, targetRole: 'admin', adminCount: 3 }).ok,
  false,
  'self-removal stays refused regardless of admin count',
);

// The last admin can never be removed — a space must never be left orphaned.
const orphan = checkRemoveMember({
  callerUid: 'admin-2', callerRole: 'admin',
  targetUid: 'admin-1', targetIsMember: true, targetRole: 'admin', adminCount: 1,
});
assert.strictEqual(orphan.ok, false, 'removing the only admin must be refused');
assert.strictEqual(orphan.status, 400);
assert.match(orphan.error, /without an admin/i);

// With two admins, one admin may remove the other.
assert.deepStrictEqual(
  checkRemoveMember({ callerUid: 'admin-2', callerRole: 'admin', targetUid: 'admin-1', targetIsMember: true, targetRole: 'admin', adminCount: 2 }),
  { ok: true },
);

// Removing someone who is not a member 404s (no roles doc == not a member).
const ghost = checkRemoveMember({ ...ADMIN, targetUid: 'stranger', targetIsMember: false, targetRole: undefined, adminCount: 1 });
assert.strictEqual(ghost.ok, false);
assert.strictEqual(ghost.status, 404);

// Missing/blank target is a 400, not a crash.
assert.strictEqual(checkRemoveMember({ ...ADMIN, targetUid: '', targetIsMember: false, adminCount: 1 }).status, 400);

// ── profileAfterRemoval ─────────────────────────────────────────────────────

// Removing the ONLY space clears the active pointer entirely (→ onboarding),
// rather than leaving it aimed at a space they can no longer read.
assert.deepStrictEqual(
  profileAfterRemoval([{ id: 'fam-1', role: 'member', type: 'family' }], 'fam-1', 'fam-1'),
  { spaces: [], familyId: null, role: null },
);

// Removing the ACTIVE space re-points at a remaining one, carrying its role.
assert.deepStrictEqual(
  profileAfterRemoval(
    [{ id: 'fam-1', role: 'member', type: 'family' }, { id: 'biz-1', role: 'admin', type: 'business' }],
    'fam-1',
    'fam-1',
  ),
  { spaces: [{ id: 'biz-1', role: 'admin', type: 'business' }], familyId: 'biz-1', role: 'admin' },
);

// Removing a NON-active space leaves the active pointer alone.
assert.deepStrictEqual(
  profileAfterRemoval(
    [{ id: 'fam-1', role: 'admin', type: 'family' }, { id: 'biz-1', role: 'member', type: 'business' }],
    'biz-1',
    'fam-1',
  ),
  { spaces: [{ id: 'fam-1', role: 'admin', type: 'family' }], familyId: 'fam-1', role: 'admin' },
);

// The removed space is always gone from spaces[], even if listed twice.
assert.deepStrictEqual(
  profileAfterRemoval(
    [{ id: 'fam-1', role: 'member' }, { id: 'fam-1', role: 'admin' }, { id: 'biz-1', role: 'member' }],
    'fam-1',
    'fam-1',
  ).spaces,
  [{ id: 'biz-1', role: 'member' }],
);

// Total on junk input — a pre-spaces[] account has no array at all.
assert.deepStrictEqual(profileAfterRemoval(undefined, 'fam-1', 'fam-1'), { spaces: [], familyId: null, role: null });
assert.deepStrictEqual(profileAfterRemoval(null, 'fam-1', undefined), { spaces: [], familyId: null, role: null });
assert.deepStrictEqual(profileAfterRemoval([null, { id: 'fam-1' }], 'fam-1', 'fam-1'), { spaces: [], familyId: null, role: null });

// A space entry with no role falls back to 'member', never to admin.
assert.strictEqual(profileAfterRemoval([{ id: 'a' }, { id: 'b' }], 'a', 'a').role, 'member');

console.log('authz.test.mjs: all assertions passed');
