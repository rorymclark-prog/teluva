import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { countryCodeForName } from './travelGeo';

let n = 0;
const check = (label: string, cond: boolean) => { assert.ok(cond, `FAILED: ${label}`); n++; };

const root = join(import.meta.dirname ?? __dirname, '..', '..');
const view = readFileSync(join(root, 'src/components/TravelTimelineView.tsx'), 'utf8');
const geo = readFileSync(join(root, 'src/utils/travelGeo.ts'), 'utf8');

/* ── PARSE BEFORE COMPRESS, ON EVERY PATH ────────────────────────────────── */

/* The constraint travelGeo's header shouts about: compressImageToAvatar
   re-encodes through <canvas>.toDataURL and strips every EXIF tag, GPS
   included. Get the order wrong and nothing throws — the photo simply has no
   location, detection "finds nothing", and the feature is quietly dead. That
   is exactly what had happened on the edit path, which never parsed at all.

   Both handlers are checked by INDEX rather than by presence, because presence
   is what the broken version would also have passed once someone added the
   call in the wrong place. */
check('the file still states the constraint it is being held to',
  /BEFORE utils\/imageCompress/.test(geo) && /Parse first, compress after/.test(geo));

for (const [label, handler] of [
  ['adding a trip', 'const handlePhotoFileChange'],
  ['attaching a photo while editing', 'const handlePhotoChange'],
] as const) {
  const body = view.slice(view.indexOf(handler), view.indexOf('};', view.indexOf(handler)));
  /* Match the CALL, not the word. Both handlers carry a comment explaining why
     the order matters, and that comment names compressImageToAvatar before the
     parse happens — the first version of this test read the prose and declared
     the correct handler broken. */
  const parse = body.indexOf('await extractTravelMeta(');
  const compress = body.indexOf('await compressImageToAvatar(');
  check(`${label} parses the EXIF at all`, parse > 0);
  check(`${label} parses it BEFORE compressing`, parse > 0 && compress > 0 && parse < compress);
}

/* ── A WRONG FLAG IS A LIE; A MISSING ONE IS ONLY LESS DECORATION ─────────── */

/* countryCode, lat/lng and the "Auto-tagged" badge are all derived from the
   country that was detected. `...entry` used to carry all three through an
   edit, so retyping Austria as France kept AT: an Austrian flag beside the word
   France, AT still in the countries-visited count, and a badge claiming the app
   had worked it out. */
const save = view.slice(view.indexOf('const save = () => {'), view.indexOf('return (', view.indexOf('const save = () => {')));
check('a retyped country is noticed', /const nameChanged = typed\.toLowerCase\(\)/.test(save));
check('and drops the code that belonged to the old one',
  /countryCode: resolved \|\| undefined/.test(save));
check('drops the pin too, rather than leaving it in the old country',
  /lat: fromPhoto \? fromPhoto\.lat : nameChanged \? undefined/.test(save));
check('and stops claiming the app detected it',
  /source: fromPhoto \? 'exif' : nameChanged \? 'manual'/.test(save));
check('an UNCHANGED country keeps everything it had',
  /: entry\.countryCode/.test(save) && /: entry\.source/.test(save));

/* ── OFFER, NEVER OVERWRITE ──────────────────────────────────────────────── */

check('a blank field is filled without asking',
  /if \(meta\?\.countryCode && !country\.trim\(\)\) setCountry/.test(view));
check('but a filled one that disagrees is only offered',
  /countryDiffers \|\| dateDiffers/.test(view) && /Use it/.test(view));
check('and the offer is a real button, not a hidden gesture',
  /onClick=\{applyPhotoDetails\}/.test(view));

/* ── THE RESOLVER, AND THE HALF-TRUTH IT MUST NOT TELL ───────────────────── */

check('the ordinary cases resolve',
  countryCodeForName('France') === 'FR'
  && countryCodeForName('Austria') === 'AT'
  && countryCodeForName('South Africa') === 'ZA');
check('case and surrounding space do not matter',
  countryCodeForName('  austria ') === 'AT');
check('a bare code is accepted, because people type them',
  countryCodeForName('FR') === 'FR' && countryCodeForName('UK') === 'GB');

/* A phone keyboard types a curly apostrophe. country-coder does not match it,
   so Côte d'Ivoire resolved and Côte d’Ivoire did not — same country, same
   spelling, different invisible character. */
check('a curly apostrophe resolves the same as a straight one',
  countryCodeForName('Côte d’Ivoire') === 'CI'
  && countryCodeForName("Côte d'Ivoire") === 'CI');

check('nonsense resolves to nothing rather than to something',
  countryCodeForName('Narnia') === null && countryCodeForName('') === null
  && countryCodeForName('x') === null);

/* NULL IS ORDINARY. These are real countries that country-coder's naming does
   not match, measured rather than assumed. The point of pinning them is that a
   future refactor which starts treating null as "invalid country" — rejecting
   the save, or showing an error — would reject the Netherlands. If this
   assertion ever starts failing because the library learned the names, that is
   good news and the list should shrink, not the behaviour change. */
for (const real of ['Netherlands', 'The Netherlands', 'Denmark', 'Ireland', 'China', 'United States']) {
  check(`"${real}" is a real country that does not resolve, and must not be rejected`,
    countryCodeForName(real) === null);
}
check('the header warns callers about exactly that',
  /NULL IS ORDINARY, NOT INVALID/.test(geo) && /Netherlands/.test(geo));

/* The flag is the one place a null code shows, and it must show as nothing. */
check('no code means no flag, not a broken one',
  /if \(!entry\.countryCode\) return null;/.test(view));

console.log(`travelGeo.test.ts: ${n} assertions passed.`);
