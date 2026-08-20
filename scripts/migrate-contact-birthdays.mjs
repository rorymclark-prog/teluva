/* One-off: move a contact's birthday out of reference/info → contacts[].birthdate
 * and into reference/extendedBirthdays → extendedBirthdays[], the list the rest
 * of the app actually reads.
 *
 * WHY. Teluva grew two homes for one fact. ContactEntry.birthdate came first,
 * described in its own comment as the way "a contact who isn't a full family
 * member (a grandparent, godparent, etc.) still gets a birthday nudge".
 * ExtendedBirthday shipped 2026-08-19 to do exactly that job properly — it
 * shows on the calendar grid, exports to .ics and rides the published feed —
 * and nobody retired the predecessor. So identical data had wildly different
 * reach depending on which field it landed in, and the ASSISTANT was pointed
 * at the weaker one: its system prompt promised "an ongoing yearly nudge like
 * a family member's birthday does" for a birthday filed as a contact, a promise
 * that stopped at two home-screen cards.
 *
 * v228 closes it — the assistant writes `extended_birthday`, the contact form
 * no longer offers a birthday field. This script moves what's already on file.
 *
 * IDEMPOTENT. A contact whose birthday is already recorded as an ExtendedBirthday
 * (same name + same month-day) is only cleared, never copied twice; a second run
 * finds nothing to do. The check is name+day rather than id, because a family may
 * have typed the same person into both places by hand before this ever ran.
 *
 * SAFE TO RUN BEFORE THE BUILD SHIPS. src/utils/extendedBirthdaySources.ts folds
 * any remaining contact birthday into the same list at read time, so a family
 * that hasn't been migrated — or a phone sitting on a cached older build, which
 * in this app is measured in days — behaves identically either way.
 *
 *   node scripts/migrate-contact-birthdays.mjs                 # dry run, writes nothing
 *   node scripts/migrate-contact-birthdays.mjs --apply
 *   FAMILY_ID=household node scripts/migrate-contact-birthdays.mjs --apply   # one family only
 */
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
admin.initializeApp({ projectId: 'gen-lang-client-0384516171' });
const db = getFirestore(admin.app(), process.env.FIRESTORE_DB_ID || 'teluva-prod');
const ONLY_FAMILY = process.env.FAMILY_ID || null;

const personKey = (name, monthDay) => `${String(name || '').trim().toLowerCase()}|${monthDay}`;

const familyRefs = ONLY_FAMILY
  ? [db.collection('families').doc(ONLY_FAMILY)]
  : await db.collection('families').listDocuments();

let movedTotal = 0;
let clearedTotal = 0;
let familiesTouched = 0;

for (const familyRef of familyRefs) {
  const [infoSnap, ebSnap] = await Promise.all([
    familyRef.collection('reference').doc('info').get(),
    familyRef.collection('reference').doc('extendedBirthdays').get(),
  ]);
  // NOTE: reference/info is FamilyInfo ({ numbers, contacts, providers }).
  // families/{id}/info/info is a DIFFERENT document (FamilyInfoDoc — space name,
  // adminUid). Reading the wrong one here would silently find no contacts.
  if (!infoSnap.exists) continue;

  const info = infoSnap.data() || {};
  const contacts = Array.isArray(info.contacts) ? info.contacts : [];
  if (!contacts.length) continue;

  const existing = (ebSnap.exists ? ebSnap.data()?.extendedBirthdays : null) || [];
  const seen = new Set(existing.map((e) => personKey(e.name, e.date)));

  const additions = [];
  const nextContacts = [];
  let clearedHere = 0;

  for (const c of contacts) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(c?.birthdate || '').trim());
    const name = String(c?.name || '').trim();
    if (!m || !name) { nextContacts.push(c); continue; }

    const monthDay = `${m[2]}-${m[3]}`;
    const key = personKey(name, monthDay);

    if (!seen.has(key)) {
      seen.add(key);
      additions.push({
        id: `ebmig-${c.id || Math.random().toString(36).slice(2)}`,
        name,
        // ContactEntry.relation is free text ("Grandmother", "Neighbour") and so
        // is ExtendedBirthday.relationship — a straight carry-across.
        ...(c.relation?.trim() ? { relationship: c.relation.trim() } : {}),
        date: monthDay,
        originalYear: Number(m[1]),
        ...(c.note?.trim() ? { notes: c.note.trim() } : {}),
        createdAt: new Date().toISOString().slice(0, 10),
        migratedFromContactId: c.id || undefined,
      });
    }

    // Drop the key entirely rather than writing birthdate: '' — the field is
    // optional, and an empty string is a value the old form would render as a
    // cleared date picker while '' is also what a half-finished edit looks like.
    const { birthdate, ...rest } = c;
    void birthdate;
    nextContacts.push(rest);
    clearedHere++;
  }

  if (!clearedHere) continue;
  familiesTouched++;
  movedTotal += additions.length;
  clearedTotal += clearedHere;

  console.log(`\n${familyRef.id}: ${clearedHere} contact birthday(s), ${additions.length} new extended birthday record(s) (already had ${existing.length})`);
  additions.forEach((a) => console.log(`   + ${a.name} — ${a.date} (${a.originalYear})${a.relationship ? ` · ${a.relationship}` : ''}`));
  if (clearedHere > additions.length) {
    console.log(`   (${clearedHere - additions.length} already recorded as an extended birthday — cleared only)`);
  }

  if (APPLY) {
    // extendedBirthdays FIRST. If the second write fails the family has a
    // duplicate row for a moment, which the read-side merge dedupes anyway.
    // The other order would lose a birthday outright.
    if (additions.length) {
      await familyRef.collection('reference').doc('extendedBirthdays')
        .set({ extendedBirthdays: [...existing, ...additions] }, { merge: true });
    }
    await familyRef.collection('reference').doc('info')
      .set({ ...info, contacts: nextContacts }, { merge: true });
    console.log('   written');
  }
}

console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — ${familiesTouched} family/families, ${movedTotal} birthday(s) ${APPLY ? 'moved' : 'would move'}, ${clearedTotal} contact field(s) ${APPLY ? 'cleared' : 'would be cleared'}.`);
process.exit(0);
