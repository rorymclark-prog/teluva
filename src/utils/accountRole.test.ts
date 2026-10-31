import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { accountRoleFromData, profileWithAuthoritativeRole, watchAccountRole, purgeAccountRoleCaches, applyAccountRoleChange, type RoleSnapshot } from './accountRole';
import type { FamilyRole } from '../types';

function fixture(initialRole: FamilyRole = 'admin') {
  const rounds: { next: (snapshot: RoleSnapshot) => void; error: (error: { code?: string }) => void; stopped: boolean }[] = [];
  const timers: { callback: () => void; cancelled: boolean }[] = [];
  const effects: unknown[] = [];
  const apply = (role: FamilyRole | null) => applyAccountRoleChange(role, {
    setRole: role => effects.push(['role', role]), purge: () => effects.push('purge'), reload: () => effects.push('reload'),
  });
  const stop = watchAccountRole({
    initialRole,
    subscribe: (next, error) => {
      const round = { next, error, stopped: false };
      rounds.push(round);
      return () => { round.stopped = true; };
    },
    onChange: apply, onRemoved: () => apply(null), onTransientError: () => effects.push('retrying'),
    schedule: callback => { const timer = { callback, cancelled: false }; timers.push(timer); return timer; },
    cancel: timer => { (timer as { cancelled: boolean }).cancelled = true; },
  });
  return { rounds, timers, effects, stop };
}

test('startup uses the authoritative role instead of a stale account mirror; missing roles produce an access notice', () => {
  assert.deepEqual(profileWithAuthoritativeRole({ role: 'admin', familyId: 'business' }, { role: 'child' }), { role: 'child', familyId: 'business' });
  assert.equal(accountRoleFromData({ role: 'owner' }), null);
  for (const data of [null, {}, { role: 'owner' }]) assert.throws(() => profileWithAuthoritativeRole({ role: 'admin' }, data), /access to this space has changed/);
});

test('cached role snapshots never change capabilities, but a confirmed change masks, purges and reloads exactly once', () => {
  const f = fixture();
  f.rounds[0].next({ exists: true, role: 'child', fromCache: true });
  f.rounds[0].next({ exists: true, role: 'admin', fromCache: false });
  assert.deepEqual(f.effects, []);
  f.rounds[0].next({ exists: true, role: 'child', fromCache: false });
  f.rounds[0].next({ exists: true, role: 'member', fromCache: false });
  assert.deepEqual(f.effects, [['role', 'child'], 'purge', 'reload']);
  assert.equal(f.rounds[0].stopped, true);
});

test('confirmed removal and permission denial fail closed instead of preserving privileged state', () => {
  for (const denied of [false, true]) {
    const f = fixture();
    if (denied) f.rounds[0].error({ code: 'permission-denied' });
    else f.rounds[0].next({ exists: false, fromCache: false });
    assert.deepEqual(f.effects, [['role', null], 'purge', 'reload']);
  }
});

test('old-account and old-space callbacks cannot affect the new subscription', () => {
  const old = fixture();
  old.stop();
  const current = fixture('member');
  old.rounds[0].next({ exists: false, fromCache: false });
  old.rounds[0].error({ code: 'permission-denied' });
  current.rounds[0].next({ exists: true, role: 'admin', fromCache: true });
  current.rounds[0].next({ exists: true, role: 'member', fromCache: false });
  assert.deepEqual(old.effects, []);
  assert.deepEqual(current.effects, []);
  current.stop();
});

test('a transient listener failure retries without granting a fallback role or reloading', () => {
  const f = fixture();
  f.rounds[0].error({ code: 'unavailable' });
  assert.deepEqual(f.effects, ['retrying']);
  assert.equal(f.rounds[0].stopped, true);
  f.rounds[0].next({ exists: true, role: 'child', fromCache: false });
  assert.deepEqual(f.effects, ['retrying'], 'late callbacks from the failed subscription are ignored');
  f.timers[0].callback();
  assert.equal(f.rounds.length, 2);
  f.rounds[1].next({ exists: true, role: 'admin', fromCache: false });
  assert.deepEqual(f.effects, ['retrying']);
  f.rounds[1].next({ exists: true, role: 'member', fromCache: false });
  assert.deepEqual(f.effects, ['retrying', ['role', 'member'], 'purge', 'reload']);
});

test('cleanup cancels retries across accounts and spaces', () => {
  const f = fixture();
  f.rounds[0].error({ code: 'unavailable' });
  f.stop();
  assert.equal(f.timers[0].cancelled, true);
  f.timers[0].callback();
  assert.equal(f.rounds.length, 1);
});

test('role changes purge current-space plaintext and pending merge intent while retaining other spaces and emergency exports', () => {
  const entries = new Map([
    ['family_members_v2_business', 'private'], ['family_finances_business', 'private'], ['family_pending_v1_members_business', '1'],
    ['family_mergeBase_user_business::member:private', 'private'], ['family_vault_reveal_v2_user:business', 'private'], ['vault_reveal_cache_v1', 'private'],
    ['family_migrated_v2_members_business', '1'], ['family_members_v2_personal', 'keep'], ['family_mergeBase_user_personal::member:child', 'keep'],
    ['teluva.emergencyPack.v2:user:business', 'offline export'], ['theme', 'keep'],
  ]);
  const storage = { get length() { return entries.size; }, key: (index: number) => [...entries.keys()][index] ?? null, removeItem: (key: string) => { entries.delete(key); } };
  purgeAccountRoleCaches(storage, 'business', 'user');
  assert.deepEqual([...entries.keys()], ['family_migrated_v2_members_business', 'family_members_v2_personal', 'family_mergeBase_user_personal::member:child', 'teluva.emergencyPack.v2:user:business', 'theme']);
});

test('FamilyProvider wires authoritative startup and cleans live subscriptions before exposing another account', () => {
  const source = fs.readFileSync(new URL('../contexts/FamilyContext.tsx', import.meta.url), 'utf8');
  const read = source.indexOf('await getDocFromServer(rolesRef)');
  const resolve = source.indexOf('profile = profileWithAuthoritativeRole(profile,');
  const publish = source.indexOf('setAccountRole(profile.role)');
  assert.ok(read > 0 && resolve > read && publish > resolve);
  assert.match(source, /includeMetadataChanges: true/);
  assert.ok((source.match(/stopRoleListener\(\)/g) || []).length >= 2);
  assert.ok(source.includes('mine === authGeneration && auth.currentUser?.uid === uid'));
  assert.ok(source.includes('clearRoleSensitiveCaches(profile.familyId, uid)'));
  assert.ok(source.includes('window.location.reload()'));
});
