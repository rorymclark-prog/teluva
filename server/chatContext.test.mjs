import test from 'node:test';
import assert from 'node:assert/strict';
import { trimContext, CTX_LIMIT, CTX_DROP_ORDER } from './chatContext.mjs';

test('a context that fits is returned untouched, no _omitted marker', () => {
  const context = { members: ['a'], expiries: ['b'] };
  const { ctxJson, dropped } = trimContext(context, 1000);
  assert.deepEqual(dropped, []);
  assert.deepEqual(JSON.parse(ctxJson), context);
});

test('members, expiries and gaps are never in the drop order', () => {
  for (const protectedKey of ['members', 'expiries', 'gaps']) {
    assert.ok(!CTX_DROP_ORDER.includes(protectedKey), `${protectedKey} must never be dropped`);
  }
});

test('sections are dropped in the declared order, cheapest-to-lose first', () => {
  // Every section carries a big deliberate filler so we control exactly how
  // many have to go to fit under a tiny limit — testing drop ORDER, not the
  // real size of any of these in production.
  const big = (label) => label.repeat(200);
  const context = {
    members: 'M', expiries: 'E', gaps: 'G',
    // shopping/familyWords/recipes/willsEstate joined buildContext() (and
    // CTX_DROP_ORDER) 2026-08-18 — included here too so this fixture still
    // covers every droppable key, the same as it did before they existed.
    // anniversaries joined the same day, right after recipes.
    shopping: big('sh'), familyWords: big('fw'), recipes: big('r'), anniversaries: big('a'),
    timeline: big('t'), calendar: big('c'), finances: big('f'),
    slips: big('s'), documents: big('d'), household: big('h'), willsEstate: big('we'),
  };
  // Small enough that several sections must go, big enough that not ALL of
  // them need to — proves order, not just "everything gets dropped". (Chosen
  // with headroom above the post-drop size WITH the _omitted marker added —
  // otherwise the marker itself could push back over budget and trigger the
  // last-resort truncation tested separately below.)
  const { ctxJson, dropped } = trimContext(context, 1850);
  const survived = JSON.parse(ctxJson);

  assert.deepEqual(dropped.slice(0, dropped.length), CTX_DROP_ORDER.slice(0, dropped.length));
  assert.equal(survived.members, 'M');
  assert.equal(survived.expiries, 'E');
  assert.equal(survived.gaps, 'G');
  for (const key of dropped) assert.equal(key in survived, false);
});

test('the omission is recorded ON the payload the model receives', () => {
  // So the assistant can say "I can't see that here" instead of confidently
  // answering from a hole — the whole point of the original fix. The limit
  // has headroom above the post-drop size WITH the _omitted marker added, so
  // this exercises the marker path rather than the last-resort truncation.
  const context = { members: 'M', household: 'H'.repeat(50) };
  const { ctxJson, dropped } = trimContext(context, 45);
  const survived = JSON.parse(ctxJson);
  assert.deepEqual(dropped, ['household']);
  assert.deepEqual(survived._omitted, ['household']);
});

test('a drop-order key that is absent from this context is skipped without error', () => {
  const context = { members: 'M', calendar: 'C'.repeat(50) };
  // 'timeline' is first in CTX_DROP_ORDER but isn't present here at all —
  // must be skipped over, not treated as "nothing left to drop".
  const { ctxJson, dropped } = trimContext(context, 60);
  assert.deepEqual(dropped, ['calendar']);
  assert.doesNotThrow(() => JSON.parse(ctxJson));
});

test('last resort: even after dropping everything droppable, oversized JSON is truncated rather than the request failing', () => {
  const context = { members: 'M'.repeat(1000) };
  const { ctxJson, dropped } = trimContext(context, 50);
  assert.ok(ctxJson.length <= 50);
  assert.ok(dropped.includes('_truncated'));
});

test('the default export limit is generous relative to the one real overflow this app has seen (~156k chars)', () => {
  // Not a claim about the model's real ceiling (~4M chars) — just that the
  // limit was deliberately raised well past the incident that motivated it,
  // not left at the old 120k or bumped by some arbitrary small amount.
  assert.ok(CTX_LIMIT >= 156_000 * 3);
});

test('a null/undefined context does not throw', () => {
  assert.doesNotThrow(() => trimContext(null));
  assert.doesNotThrow(() => trimContext(undefined));
  const { ctxJson } = trimContext(undefined, 1000);
  assert.deepEqual(JSON.parse(ctxJson), {});
});
