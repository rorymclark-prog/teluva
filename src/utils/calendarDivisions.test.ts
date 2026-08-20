import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// The "Calendar panels" settings section promises, in its own words, that you
// can "choose which at-a-glance panels show at the top of the Family Calendar".
// Three separate files have to agree for that to be true:
//
//   types.ts            — the HubSettings.calendarDivisions keys
//   FamilyCalendar.tsx  — a division that actually reads its key
//   FamilySettings.tsx  — a switch row the family can reach
//
// They drifted. `extendedBirthdays` (v223) and `vacations` shipped a key AND a
// gated division but never got a switch, so two of the panels on that screen
// could not be turned off while the section above them said they could. That is
// the same class as a button whose handler was never wired: the promise is in
// the UI, the code behind it is missing, and nothing failed.
//
// This test is the guard. Add a key to calendarDivisions and you must add the
// switch, or this goes red with the key's name in the message.
// ---------------------------------------------------------------------------

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');

const types = read('types.ts');
const settings = read('components/FamilySettings.tsx');
const calendar = read('components/FamilyCalendar.tsx');

// --- the declared keys -----------------------------------------------------
const block = types.match(/calendarDivisions\?: \{([\s\S]*?)\n {2}\};/);
assert.ok(block, 'could not find the calendarDivisions block in types.ts — has it been renamed?');
const declared = [...block[1].matchAll(/^\s*(\w+)\?: boolean;/gm)].map((m) => m[1]);
assert.ok(declared.length >= 6, `expected several calendarDivisions keys, found ${declared.length}`);

// --- every key has a switch row the family can actually reach --------------
const rows = [...settings.matchAll(/key: '(\w+)'/g)].map((m) => m[1]);
for (const key of declared) {
  assert.ok(
    rows.includes(key),
    `HubSettings.calendarDivisions.${key} has no switch in FamilySettings' CALENDAR_DIVISIONS. ` +
      'The section tells the family they can choose which panels show; a key with no row makes that untrue ' +
      'for that panel. Add a row (label + sublabel if it needs explaining).',
  );
}

// --- and no switch row points at a key that no longer exists ---------------
for (const key of rows) {
  assert.ok(
    declared.includes(key),
    `FamilySettings has a CALENDAR_DIVISIONS row for "${key}", which is not a HubSettings.calendarDivisions key. ` +
      'A switch that writes a key nothing reads is a dead toggle.',
  );
}

// --- every key is genuinely read by a division on the calendar -------------
for (const key of declared) {
  assert.ok(
    calendar.includes(`calendarDivisions?.${key}`),
    `FamilyCalendar never reads calendarDivisions.${key}, so its switch does nothing.`,
  );
}

// --- the counts in the prose stay honest -----------------------------------
// The comments and the section's own copy used to say "six" panels while eight
// existed. Nobody notices a stale number in a comment; a family notices a
// switch that isn't there. Cheapest place to catch it is here.
for (const [file, src] of [['FamilySettings.tsx', settings], ['FamilyCalendar.tsx', calendar], ['Dashboard.tsx', read('components/Dashboard.tsx')]] as const) {
  const stale = src.match(/(six|seven|eight|nine)\s+(?:"at a glance"|“at a glance”|at-a-glance)/i);
  if (stale) {
    const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    assert.equal(
      stale[1].toLowerCase(),
      WORDS[declared.length],
      `${file} says "${stale[0]}" but there are ${declared.length} calendarDivisions keys.`,
    );
  }
}

// --- the settings screen's write must not be invisible ---------------------
// FamilySettings is a SIBLING of Dashboard (see App.tsx) and writes the shared
// settings doc directly, while the calendar reads Dashboard's in-memory copy —
// loaded once, in an effect keyed on the signed-in user and the active space.
// Nothing in that dep list changes when a switch is flipped, so every toggle in
// this section was invisible until a full app reload. The fix is a version
// counter App bumps on change and Dashboard re-reads on; assert both halves are
// still wired, because the failure mode is silent.
{
  const app = read('App.tsx');
  assert.match(
    app,
    /onSettingsChanged=/,
    'App.tsx no longer passes onSettingsChanged to FamilySettings — settings changed there become invisible until reload.',
  );
  assert.match(
    app,
    /settingsVersion=\{/,
    'App.tsx no longer passes settingsVersion to Dashboard — nothing tells it to re-read the settings doc.',
  );
  assert.match(
    settings,
    /onSettingsChanged\?\.\(\)/,
    'FamilySettings no longer calls onSettingsChanged after saving — the calendar keeps rendering the old panels.',
  );
  const dash = read('components/Dashboard.tsx');
  assert.match(
    dash,
    /\[settingsVersion\]/,
    'Dashboard has no effect keyed on settingsVersion — a settings change made in FamilySettings never reaches the calendar.',
  );
}

console.log(`calendarDivisions.test.ts: all assertions passed (${declared.length} divisions)`);
