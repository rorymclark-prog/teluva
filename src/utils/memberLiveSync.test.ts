import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { watchReadableMembers } from './memberLiveSync';

type Member = { id: string; name: string };
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
function setup(reveal: (member: Member) => Promise<Member> = async member => member) {
  const handlers = new Map<string, { value: (member: Member | undefined) => void; error: (error: unknown) => void }>();
  const views: Member[][] = [];
  const revoked: string[] = [];
  const errors: unknown[] = [];
  const stopped: string[] = [];
  let canAdopt = true;
  let refreshSaved: () => void = () => { throw new Error('No save observer'); };
  const stop = watchReadableMembers<Member>({ ids: ['own', 'second-own', 'own'],
    watch: (id, value, error) => { handlers.set(id, { value, error }); return () => { stopped.push(id); }; },
    reveal, canAdopt: () => canAdopt, publish: value => views.push(value), onRevoked: id => revoked.push(id), onError: error => errors.push(error),
    onSaved: refresh => { refreshSaved = refresh; return () => {}; },
  });
  return { handlers, views, revoked, errors, stopped, stop, refreshSaved: () => refreshSaved(), setCanAdopt: (value: boolean) => { canAdopt = value; } };
}
const live = setup();
assert.deepEqual([...live.handlers.keys()], ['own', 'second-own'], 'only explicitly authorized loaded profiles are watched');
live.handlers.get('own')!.value({ id: 'own', name: 'Old' });
await flush();
assert.equal(live.views.length, 0, 'wait for all known profiles before replacing the visible projection');
live.handlers.get('second-own')!.value({ id: 'second-own', name: 'Two' });
await flush();
assert.deepEqual(live.views.at(-1)!.map(member => member.name), ['Old', 'Two']);
live.handlers.get('own')!.value({ id: 'own', name: 'Saved on another device' });
await flush();
assert.equal(live.views.at(-1)![0].name, 'Saved on another device');
live.setCanAdopt(false);
live.handlers.get('own')!.value({ id: 'own', name: 'Remote during pending local edit' });
await flush();
assert.equal(live.views.at(-1)![0].name, 'Saved on another device', 'pending local work/scope mismatch cannot be overwritten');
live.handlers.get('own')!.error({ code: 'permission-denied' });
assert.deepEqual(live.revoked, ['own'], 'revocation is handled even when pending local work prevents normal adoption');
live.setCanAdopt(true);
live.handlers.get('second-own')!.value({ id: 'second-own', name: 'Two updated' });
await flush();
assert.deepEqual(live.views.at(-1), [{ id: 'second-own', name: 'Two updated' }], 'the revoked HR record cannot reappear');
live.handlers.get('second-own')!.error({ code: 'unavailable' });
assert.equal(live.errors.length, 1);
assert.equal(live.views.at(-1)!.length, 1, 'transient failures do not erase the readable record');
live.stop();
live.handlers.get('second-own')!.error({ code: 'permission-denied' });
assert.deepEqual(live.revoked, ['own'], 'late callbacks from stopped listeners cannot purge a new view');
assert.deepEqual(live.stopped, ['own', 'second-own']);

let resolveOld!: (value: Member) => void;
const delayed = setup(member => member.name === 'Old' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(member));
delayed.handlers.get('own')!.value({ id: 'own', name: 'Old' });
delayed.handlers.get('second-own')!.value({ id: 'second-own', name: 'Two' });
delayed.handlers.get('own')!.value({ id: 'own', name: 'Newest' });
await flush();
resolveOld({ id: 'own', name: 'Old' });
await flush();
assert.equal(delayed.views.at(-1)![0].name, 'Newest', 'a slow reveal of an older snapshot cannot win');
delayed.stop();

const pending = setup();
pending.handlers.get('own')!.value({ id: 'own', name: 'Initially loaded' });
pending.handlers.get('second-own')!.value({ id: 'second-own', name: 'Two' });
await flush();
pending.setCanAdopt(false);
const previousConnection = pending.handlers.get('own')!;
previousConnection.value({ id: 'own', name: 'Server echo during save' });
await flush();
pending.setCanAdopt(true);
pending.refreshSaved();
assert.deepEqual(pending.stopped, ['own', 'second-own'], 'settling the local save requests fresh authorized server confirmation');
assert.equal(pending.views.at(-1)![0].name, 'Initially loaded', 'a pre-save held snapshot is not flushed over a newly committed local edit');
previousConnection.value({ id: 'own', name: 'Late older callback' });
pending.handlers.get('own')!.value({ id: 'own', name: 'Confirmed merge of local and remote changes' });
pending.handlers.get('second-own')!.value({ id: 'second-own', name: 'Two' });
await flush();
assert.equal(pending.views.at(-1)![0].name, 'Confirmed merge of local and remote changes', 'no unrelated remote edit is needed to resume publication after a save');
pending.stop();

const dashboard = readFileSync(new URL('../components/Dashboard.tsx', import.meta.url), 'utf8');
const db = readFileSync(new URL('./db.ts', import.meta.url), 'utf8');
assert.match(dashboard, /isBusinessSpace && !isAdmin \? membersRef\.current\.map\(member => member\.id\) : undefined/, 'employees watch their loaded subset; admins retain the complete collection listener');
assert.match(db, /uid === auth\.currentUser\?\.uid && !isDirty\('members', space\)/);
assert.match(db, /if \(stopped \|\| space !== FAMILY_ID \|\| uid !== auth\.currentUser\?\.uid\) return;/);
assert.match(db, /records = undefined; ids = undefined; revoke\(\)/, 'denied collection reads invalidate old in-flight snapshots and purge cached HR records');
console.log('memberLiveSync: authorized subscriptions, live remote edits, pending work, revocation, async ordering and cleanup passed');
