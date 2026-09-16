import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

let n = 0;
const check = (label: string, cond: boolean) => { assert.ok(cond, `FAILED: ${label}`); n++; };

const root = join(import.meta.dirname ?? __dirname, '..', '..');
const card = readFileSync(join(root, 'src/components/NamedByThemCard.tsx'), 'utf8');

/* A projection nobody renders is the same as no projection. The server work in
   familyLink.mjs is guarded by familyLink.test.mjs; this file guards the half
   that decides whether a human ever sees it. */

check('the card renders the findability line at all', /named\.findWill/.test(card));

/* IT MUST NOT BE GATED ON A RUNG. The whole point is that 'fact' carries it, and
   the easiest way to lose that is a well-meaning `level === 'documents' &&`
   added in front of it later. */
/* The slice MUST start at the line that OPENS the block, not at the first
   mention of findWill inside it — an earlier version started at the mention,
   so a `level === 'documents' &&` prepended to the very same line sat outside
   the slice and the guard passed with the block gated. */
const open = card.lastIndexOf('\n      {', card.indexOf('named.findWill'));
const block = card.slice(open, card.indexOf("{level === 'fact' &&"));
check('the slice really does start at the opening brace of the block',
  /^\n\s*\{[^\n]*named\.findWill/.test(block));
check('the findability block is not gated on a level',
  block.length > 200 && !/level\s*===/.test(block));

check('all four shapes are handled: registered, custodian, location, unrecorded',
  /w\.unrecorded/.test(block) && /w\.registered/.test(block)
  && /w\.heldBy \|\| w\.notaryName/.test(block) && /w\.originalLocation/.test(block));

/* The unrecorded case is the one worth acting on, and the tone decides whether
   it reads as a nudge or as a complaint about somebody's affairs. */
check('the unrecorded case invites a question rather than passing judgement',
  /worth asking them/i.test(block) && !/should have|failed to|neglected|careless/i.test(block));

/* TWO SENTENCES WERE MADE FALSE BY v326 AND BOTH HAD TO GO. Either one
   surviving would have the app promising the opposite of what it now does. */
check('the fact rung no longer promises that where the papers are stays with them',
  !/where their\s*\n?\s*papers are, stays with them/.test(card));
check('the paper list no longer claims where these are kept stays with them',
  !/Where these are kept, and the documents themselves, stay with/.test(card));
check('and the paper list now names the exception out loud',
  /except the will/i.test(card));

/* Free text from another household. It is rendered as text and never as
   markup, a link, or anything the browser will act on. */
check('another household’s text is not linkified or dangerously set',
  !/dangerouslySetInnerHTML/.test(card) && !/<a\s+href=\{/.test(card));

const types = readFileSync(join(root, 'src/utils/familyLink.ts'), 'utf8');
const shape = types.slice(types.indexOf('findWill?:'), types.indexOf('findWill?:') + 400);
check('the client type carries every field the server can send',
  ['kind', 'heldBy', 'notaryName', 'registered', 'registryName', 'originalLocation', 'unrecorded']
    .every((f) => shape.includes(f)));
check('and it does NOT carry the notary direct line the server withholds',
  !shape.includes('notaryPhone'));

console.log(`findWillRender.test.ts: ${n} assertions passed.`);
