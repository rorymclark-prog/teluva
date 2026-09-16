import React, { useMemo, useState } from 'react';
import { ArrowLeft, User, Shirt, Gift, HeartPulse, Phone, Sparkles, BookOpen, PartyPopper, Palette } from 'lucide-react';
import { sharedAge } from '../utils/familyLink';
import { sunSign, elementTint } from '../utils/astrology';
import { resolveCelebrations } from '../utils/nameCelebrations';
import { confidenceLabel, roleLabel } from '../utils/nameMeanings';
import type { SharedMember, ShareCategory } from '../utils/familyLink';
import { HideDatesButton, linkedDates } from '../contexts/HiddenPeopleContext';
import { hiddenKey } from '../utils/hiddenPeople';

/* A CONNECTED PERSON'S PROFILE — in the SAME PANEL as a member's, not a modal.
 *
 * Rory, twice: "can it open up as a proper profile where you can click around,
 * albeit restricted info, but at least it looks familiar", then "i want it to
 * open normally like the other profiles not a new modal". A cousin is a person,
 * not a search result, and a modal made the restriction feel like a fault in
 * the app rather than a fact about the other household.
 *
 * It renders where the member panel renders, so it inherits that column's
 * scroll, width and sticky behaviour — and it sidesteps the bug the modal
 * version had, where being rendered inside the sticky family-list card trapped
 * its z-index in that card's stacking context and the member panel painted its
 * avatar straight over the top.
 *
 * So: same avatar ring, same chips, same tab pills as the member panel — but
 * READ-ONLY, built purely from the allowlisted projection in
 * server/familyLink.mjs. There is no medical, document, ID or contact data
 * behind this screen to leak, because none of it ever crossed. The last tab
 * SAYS that, out loud, instead of leaving somebody to wonder whether the app
 * is broken or their sister just hasn't filled it in.
 */

type TabId = 'overview' | 'likes' | 'sizes' | 'wishes' | 'care';

const SIZE_LABELS: Array<[keyof NonNullable<SharedMember['clothingSizes']>, string]> = [
  ['tops', 'Tops'],
  ['bottoms', 'Bottoms'],
  ['shoes', 'Shoes'],
  ['outerwear', 'Outerwear'],
  ['dressSize', 'Dress'],
  ['jacketSize', 'Jacket'],
  ['hatValue', 'Hat'],
  ['ringSize', 'Ring'],
  ['heightCm', 'Height (cm)'],
];

/* What they are into, in the order somebody buying a present would want it:
   the broad strokes first, the specifics after. `dietaryRestrictions` is last
   and deliberately labelled as a restriction rather than a taste — it arrives
   only when a family switched on "In your care", and treating it as one more
   favourite would misread why it was sent. */
const LIKE_LABELS: Array<[keyof NonNullable<SharedMember['preferences']>, string]> = [
  ['hobbies', 'Hobbies'],
  ['sports', 'Sport'],
  ['colorPreferences', 'Colours'],
  ['favoriteMusic', 'Music'],
  ['favoriteBooks', 'Books'],
  ['favoriteMovies', 'Films'],
  ['favoriteGames', 'Games'],
  ['clothingBrands', 'Brands'],
  ['favoriteMeals', 'Food they love'],
  ['dislikedFoods', 'Not a fan of'],
  ['dietaryRestrictions', 'Must avoid'],
];

/* The honest empty state. Only ever rendered for a category the server told
   us is switched ON, so it says nobody has filled it in — which is true —
   rather than implying the other household held it back. */
const NothingYet: React.FC<{ what: string; who: string }> = ({ what, who }) => (
  <div className="rounded-2xl border border-dashed border-cream-300 bg-cream-50/50 px-4 py-6 text-center">
    <p className="text-[13px] text-ink-500">
      No {what} for {who} yet.
    </p>
    <p className="text-[12px] text-ink-400 mt-1">
      Their family shares this with you — there is just nothing in it so far.
    </p>
  </div>
);

export function sharedLikes(member: SharedMember): Array<[string, string]> {
  const p = member.preferences;
  if (!p) return [];
  return LIKE_LABELS
    .map(([key, label]) => [label, (p[key] || '').trim()] as [string, string])
    .filter(([, v]) => v.length > 0);
}

export function sharedSizeEntries(member: SharedMember): Array<[string, string]> {
  const sizes = member.clothingSizes || {};
  const out: Array<[string, string]> = [];
  for (const [key, label] of SIZE_LABELS) {
    const raw = (sizes as Record<string, unknown>)[key as string];
    const value = typeof raw === 'number' ? String(raw) : String(raw ?? '').trim();
    if (value) out.push([label, value]);
  }
  return out;
}

export function sharedWishes(member: SharedMember) {
  return (member.favorites || []).filter((f) => f && f.isWishlist && !f.bought);
}

/* THE CARE CARD — Rory: "if i am looking after my sisters kids i want to be
 * able to see emergency contact info like the baby sitter".
 *
 * Ordered by what you would need first with a child in front of you, not by
 * how the fields sit in the type: what could hurt them, what stops it, what
 * they take anyway, what to mention, and who to ring. Only present at all if
 * their household switched 'care' on for this person — see the `care`
 * category in server/familyLink.mjs, which is opt-in and never a default. */
const CARE_ROWS: Array<[keyof NonNullable<SharedMember['medical']>, string]> = [
  ['allergies', 'Allergic to'],
  ['emergencyMedication', 'In an emergency'],
  ['medications', 'Takes regularly'],
  ['conditions', 'Ongoing'],
  ['bloodGroup', 'Blood group'],
];

export function sharedCareRows(member: SharedMember): Array<[string, string]> {
  const med = member.medical || {};
  const out: Array<[string, string]> = [];
  for (const [key, label] of CARE_ROWS) {
    const v = String(med[key] ?? '').trim();
    if (v) out.push([label, v]);
  }
  return out;
}

/** True when anything at all crossed under 'care' — rows OR a phone number. */
export const hasSharedCare = (member: SharedMember): boolean =>
  sharedCareRows(member).length > 0
  || !!(member.emergencyContactName || member.emergencyContactPhone);

const SharedProfile: React.FC<{
  member: SharedMember;
  householdName: string;
  /** The link they came over; a person is hidden per link ("Hide Nora's dates"). */
  linkId?: string;
  onClose: () => void;
  onViewPhoto?: (url: string) => void;
}> = ({ member, householdName, linkId, onClose, onViewPhoto }) => {
  const sizes = useMemo(() => sharedSizeEntries(member), [member]);
  const wishes = useMemo(() => sharedWishes(member), [member]);
  const care = useMemo(() => sharedCareRows(member), [member]);
  const likes = useMemo(() => sharedLikes(member), [member]);
  const showCare = hasSharedCare(member);
  const [tab, setTab] = useState<TabId>('overview');

  const age = sharedAge(member.birthdate);

  /* DERIVED HERE, NOT CROSSED. The star sign is a pure function of the
     birthdate, so it needs no field, no switch and no second source of truth
     — and it is automatically absent when the birthday was not shared, which
     is exactly the right rule with nothing enforcing it. */
  const sign = useMemo(() => sunSign(member.birthdate), [member.birthdate]);
  const meanings = member.nameMeanings ?? [];
  /* The same resolver the household's own profiles use, run on the fields
     that crossed. One implementation, so a shared name day can never drift
     from the one its own family sees. */
  const celebrations = useMemo(() => resolveCelebrations({
    name: member.name,
    nameDay: member.nameDay,
    nameDayFeast: member.nameDayFeast,
    nameCelebrations: member.nameCelebrations,
    nameCelebrationResolvedDates: member.nameCelebrationResolvedDates,
  }), [member.name, member.nameDay, member.nameDayFeast, member.nameCelebrations, member.nameCelebrationResolvedDates]);
  const namedays = celebrations.primary
    ? [celebrations.primary, ...celebrations.additional]
    : celebrations.additional;
  /* A TAB APPEARS BECAUSE THE SWITCH IS ON, NOT BECAUSE DATA ARRIVED.
   *
   * Rory: "there must be wishlist and all other possible things to show BUT
   * if there is nothing to show it must say so and so hasnt filled it yet."
   * Hiding an empty Wish list made a perfectly working feature look missing —
   * his own profile showed two tabs and read as broken.
   *
   * The reason this could not simply be "always show every tab" is the other
   * half of the same complaint, from earlier: "it says i have no shared sizes
   * or wish list but i have not not shared, everything is shared." An empty
   * state drawn for a switched-OFF category tells the reader that a family
   * left something blank when in fact they chose not to send it — a false
   * statement about somebody else, and the reason the "Not shared" tab died.
   *
   * So the server now says which switches are on (sharedCategories) and the
   * empty state is drawn ONLY there, where "nothing added yet" is true. A
   * category that is off stays absent and unmentioned, as before. */
  const onCats = member.sharedCategories;
  /* No list = a payload from before v322, or a cached one. Fall back to the
     old data-presence rule rather than inventing switches: a stale response
     must not manufacture an empty state it cannot vouch for. */
  const shows = (cat: ShareCategory, hasData: boolean) =>
    (onCats ? onCats.includes(cat) : hasData);

  const tabs: Array<{ id: TabId; label: string; icon: typeof User }> = [
    { id: 'overview', label: 'Overview', icon: User },
    /* Second, right after Overview, when it exists — if this tab is ever
       needed it is needed in a hurry, and hunting past Sizes and Wish list
       for an EpiPen is not a design anyone should have to survive. */
    ...(shows('care', showCare) ? [{ id: 'care' as TabId, label: 'In your care', icon: HeartPulse }] : []),
    ...(shows('interests', likes.length > 0) ? [{ id: 'likes' as TabId, label: 'What they like', icon: Palette }] : []),
    ...(shows('sizes', sizes.length > 0) ? [{ id: 'sizes' as TabId, label: 'Sizes', icon: Shirt }] : []),
    ...(shows('wishes', wishes.length > 0) ? [{ id: 'wishes' as TabId, label: 'Wish list', icon: Gift }] : []),
    /* NO "Not shared" TAB. Rory: "lets remove the not shared button". A whole
       tab listing what you cannot see made the restriction the loudest thing
       on a person's profile, and it was the first thing anyone clicked. The
       reassurance it carried is real, so it survives as one quiet line at the
       bottom of Overview — read once, not offered as a destination. */
  ];

  /* Same shell as the member panel: `card overflow-hidden min-h-[500px] flex
   * flex-col`. Matching it is the point — a different-looking container is
   * exactly what made this read as a restriction rather than a person. */
  return (
      <div className="card overflow-hidden min-h-[500px] flex flex-col">
        <div className="p-5 sm:p-6 border-b border-cream-200 flex flex-col gap-5">
          <div className="flex items-start gap-4 min-w-0">
            <div className="avatar-ring shrink-0">
              {member.avatarUrl ? (
                /* Full size, uncropped and clickable through to the lightbox —
                   the same treatment a member's photo gets. A shared photo
                   arrives at whatever resolution their household stored, so it
                   is never upscaled here. */
                <button
                  type="button"
                  onClick={() => onViewPhoto?.(member.avatarUrl!)}
                  className="block w-24 h-24 lg:w-28 lg:h-28 rounded-full overflow-hidden bg-white cursor-zoom-in"
                  title="View photo"
                >
                  <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover" />
                </button>
              ) : (
                <div className={`w-24 h-24 lg:w-28 lg:h-28 rounded-full ${member.avatarColor || 'bg-clay-500'} text-white font-bold text-3xl flex items-center justify-center uppercase`}>
                  {(member.name.trim()[0] || '?').toUpperCase()}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-ink-900 truncate">
                {member.nickname || member.name}
              </h2>
              <p className="text-[12px] text-ink-500 font-medium mt-1 flex flex-wrap items-center gap-1.5">
                {member.role && <span className="chip bg-cream-200 text-ink-600">{member.role}</span>}
                {age && <span className="chip bg-dusk-100 text-dusk-700 tabular-nums">{age}</span>}
                {member.birthdate && <span className="text-ink-400 tabular-nums">born {member.birthdate}</span>}
                {linkId && linkedDates(member).length > 0 && (
                  <HideDatesButton
                    showHiddenState
                    className="-my-1"
                    target={{ key: hiddenKey.linked(linkId, member.id), name: member.nickname || member.name, dates: linkedDates(member) }}
                  />
                )}
              </p>
              <p className="text-[12.5px] text-ink-500 mt-2">
                {householdName ? <>Lives in <span className="font-semibold text-ink-700">{householdName}</span></> : 'A connected family'}
              </p>
            </div>
            {/* Back, not close: this panel replaced the member you were looking
                at, so the honest control returns you there. */}
            <button
              type="button"
              onClick={onClose}
              className="btn-quiet text-[12px] px-2.5 py-1.5 shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Your family
            </button>
          </div>

          <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                title={t.label}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`tab-pill px-3 shrink-0 ${tab === t.id ? 'tab-pill-active' : ''}`}
              >
                <t.icon className="w-4 h-4" />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 sm:p-6 flex-1 space-y-5">
          {tab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Fact label="Name" value={member.name} />
                {member.nickname && <Fact label="Goes by" value={member.nickname} />}
                {member.role && <Fact label="Role at home" value={member.role} />}
                {member.birthdate && <Fact label="Birthday" value={`${member.birthdate}${age ? ` · ${age}` : ''}`} />}
              </div>
              {/* IT MUST NOT CLAIM TO KNOW WHY. Rory: "it says i have n shared
                  sizes or wish list but i have not not shared everything is
                  shared" — and he was right, the categories were on. Nothing
                  crossed because a newly added person has no sizes recorded
                  yet, but the sentence blamed the other household for
                  withholding.

                  This side genuinely CANNOT tell the difference: which
                  categories are switched on is deliberately not projected —
                  what they chose is their business. So the honest sentence is
                  the one that is true either way and accuses nobody. */}
              {/* WHO THEY ARE, not what is missing. Rory: a shared profile is
                  "just boring at the moment" — four grey facts and a tab
                  telling you what you cannot see. Everything below is either
                  derived from what already crossed or is a warm fact the other
                  household chose to share. */}
              {sign && (
                <div className={`rounded-2xl border px-4 py-3.5 ${elementTint(sign.element)}`}>
                  <p className="text-[13.5px] font-bold text-ink-900 flex items-center gap-2">
                    <span className="text-[19px] leading-none" aria-hidden>{sign.symbol}</span>
                    {sign.sign}
                    <span className="chip bg-white/70 text-ink-600">{sign.element}</span>
                  </p>
                  <p className="text-[12.5px] text-ink-600 mt-1">{sign.blurb}</p>
                </div>
              )}

              {/* Same rule as the tabs: the heading appears because the switch
                  is on, so an empty one is a true "nobody has looked this up",
                  not an implication that it was held back. */}
              {shows('about', meanings.length > 0) && (
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-400 mb-2 flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5" /> What their name means
                  </h3>
                  {meanings.length === 0 && (
                    <p className="text-[12.5px] text-ink-400 rounded-2xl border border-dashed border-cream-300 bg-cream-50/50 px-3.5 py-3">
                      Nobody has looked up what {member.name.split(/\s+/)[0]} means yet.
                    </p>
                  )}
                  <div className="space-y-2">
                    {meanings.map((m) => (
                      <div key={`${m.role}-${m.token}`} className="rounded-2xl border border-cream-200 bg-cream-50/60 px-3.5 py-3">
                        <p className="text-[13.5px] font-bold text-ink-900">
                          {m.token}
                          <span className="font-normal text-ink-500"> — {m.meaning}</span>
                        </p>
                        <p className="text-[11.5px] text-ink-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span>{roleLabel(m.role)}</span>
                          {m.origin && <span>· {m.origin}</span>}
                          {/* THE HEDGE IS NOT OPTIONAL. A derivation stated
                              flat is the app asserting folk etymology as fact
                              about somebody else's family — see NameMeaning
                              in types.ts. It crosses with the meaning and is
                              rendered beside it, here as everywhere. */}
                          <span className="chip bg-white text-ink-500">{confidenceLabel(m.confidence)}</span>
                        </p>
                        {m.explanation && (
                          <p className="text-[12.5px] text-ink-600 mt-1.5 leading-snug">{m.explanation}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Rory: "i want the name day info also to show, that is if the
                  family has toggled on sharing name days". The switch is doing
                  exactly the work it should here — `celebrations` is OPT-IN
                  because a feast day names a religion, so this heading appears
                  only for a family that deliberately chose to send it, and an
                  empty one is then honestly "none recorded" rather than a
                  guess about somebody's faith. */}
              {shows('celebrations', namedays.length > 0) && (
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-400 mb-2 flex items-center gap-1.5">
                    <PartyPopper className="w-3.5 h-3.5" /> Name days
                  </h3>
                  {namedays.length === 0 && (
                    <p className="text-[12.5px] text-ink-400 rounded-2xl border border-dashed border-cream-300 bg-cream-50/50 px-3.5 py-3">
                      No name day recorded for {member.name.split(/\s+/)[0]} yet.
                    </p>
                  )}
                  <div className="space-y-2">
                    {namedays.map((c) => (
                      <div key={c.id} className="rounded-2xl border border-cream-200 bg-white px-3.5 py-3">
                        <p className="text-[13.5px] font-bold text-ink-900">{c.title}</p>
                        <p className="text-[11.5px] text-ink-400 mt-0.5">
                          {c.dateType === 'fixed' && c.date
                            ? c.date.replace('-', '/')
                            : c.movableRule || 'Changes each year'}
                          {c.tradition ? ` · ${c.tradition}` : ''}
                        </p>
                        {c.explanation && (
                          <p className="text-[12.5px] text-ink-600 mt-1.5 leading-snug">{c.explanation}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* What used to be a whole tab. One line, last, stated once —
                  and still refusing to claim WHY something is absent, because
                  this side cannot tell a switched-off category from an empty
                  one. */}
              <p className="text-[12px] text-ink-400 leading-snug pt-1">
                This is what {householdName || 'their household'} chose to share about {member.name}.
                Documents, ID numbers, contact details, schooling and finances stay with them, and
                they can change what crosses at any time — as can you, under Connected families → Manage.
              </p>
            </div>
          )}

          {tab === 'care' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-clay-300 bg-clay-50 px-4 py-3.5">
                <p className="text-[13.5px] font-bold text-ink-900 flex items-center gap-2">
                  <HeartPulse className="w-4 h-4 text-clay-600 shrink-0" />
                  If {member.nickname || member.name} is with you
                </p>
                <p className="text-[12.5px] text-ink-600 mt-1">
                  {householdName || 'Their household'} shared this so whoever is minding
                  them knows what matters. It is not their medical record.
                </p>
              </div>

              {/* NOT the NothingYet card, deliberately. Everywhere else an empty
                  section means "nobody wrote anything and that is fine". Here
                  the reader is about to feed or mind a child, and a cheerful
                  "no medical details yet" is one short step from "so there are
                  no allergies" — which is a conclusion this screen has no
                  standing to support. Absence of a record is not a record of
                  absence, so the copy says exactly that and points at the only
                  reliable move, which is asking them. */}
              {care.length === 0 && (
                <div className="rounded-2xl border border-dashed border-clay-300 bg-white px-4 py-4">
                  <p className="text-[13px] font-semibold text-ink-800">
                    Nothing has been filled in here yet.
                  </p>
                  <p className="text-[12.5px] text-ink-600 mt-1 leading-snug">
                    That is not the same as “no allergies” or “no medicines”. Nobody has
                    written anything down — so if {member.nickname || member.name} is
                    staying with you, ask {householdName || 'their household'} directly
                    rather than reading anything into this being empty.
                  </p>
                </div>
              )}

              {care.length > 0 && (
                <div className="space-y-2">
                  {care.map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-cream-200 bg-white px-3.5 py-2.5">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">{label}</p>
                      <p className="text-[14px] font-semibold text-ink-900 mt-0.5 whitespace-pre-wrap">{value}</p>
                    </div>
                  ))}
                </div>
              )}

              {(member.emergencyContactName || member.emergencyContactPhone) && (
                <div>
                  <p className="section-label mb-2">Who to ring</p>
                  {/* A real tel: link. Somebody reading this screen is probably
                      holding the phone one-handed, and retyping a number off a
                      card is the last thing they should be doing. */}
                  <a
                    href={member.emergencyContactPhone ? `tel:${member.emergencyContactPhone.replace(/[^\d+]/g, '')}` : undefined}
                    className="flex items-center gap-3 rounded-xl border border-sage-300 bg-sage-50 px-3.5 py-3 hover:bg-sage-100 transition-colors"
                  >
                    <Phone className="w-4 h-4 text-sage-700 shrink-0" />
                    <span className="min-w-0 flex-1">
                      {member.emergencyContactName && (
                        <span className="block text-[13.5px] font-bold text-ink-900 truncate">{member.emergencyContactName}</span>
                      )}
                      {member.emergencyContactPhone && (
                        <span className="block text-[13px] text-ink-600 tabular-nums">{member.emergencyContactPhone}</span>
                      )}
                    </span>
                  </a>
                </div>
              )}

              <p className="text-[12px] text-ink-400">
                In a real emergency ring the emergency services first — this is
                the handover note, not a substitute for one.
              </p>
            </div>
          )}

          {tab === 'likes' && (
            <div>
              <p className="section-label mb-2">What they are into</p>
              {likes.length === 0 && <NothingYet what="hobbies or favourites" who={member.nickname || member.name} />}
              <div className="space-y-2">
                {likes.map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-cream-200 bg-cream-50/60 px-3.5 py-2.5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">{label}</p>
                    <p className="text-[13.5px] text-ink-800 mt-0.5 leading-snug whitespace-pre-wrap">{value}</p>
                  </div>
                ))}
              </div>
              {likes.length > 0 && (
                <p className="text-[12px] text-ink-400 mt-3">
                  Their own words, so a present can be a good guess rather than a lucky one.
                </p>
              )}
            </div>
          )}

          {tab === 'sizes' && (
            <div>
              <p className="section-label mb-2">What fits</p>
              {sizes.length ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {sizes.map(([label, value]) => <Fact key={label} label={label} value={value} />)}
                </div>
              ) : <NothingYet what="sizes" who={member.nickname || member.name} />}
            </div>
          )}

          {tab === 'wishes' && (
            <div>
              <p className="section-label mb-2">Still wanted</p>
              {wishes.length === 0 && <NothingYet what="wish list" who={member.nickname || member.name} />}
              <ul className="space-y-2">
                {wishes.map((w) => (
                  <li key={w.id} className="rounded-xl border border-cream-200 bg-cream-50/60 px-3.5 py-2.5 flex items-baseline gap-2">
                    <Gift className="w-3.5 h-3.5 text-rosa-500 shrink-0 self-center" />
                    <span className="flex-1 text-[13.5px] font-semibold text-ink-800">{w.title}</span>
                    {w.targetPrice && <span className="text-[12px] text-ink-400 tabular-nums shrink-0">{w.targetPrice}</span>}
                  </li>
                ))}
              </ul>
              {wishes.length > 0 && (
                <p className="text-[12px] text-ink-400 mt-3">Bought items disappear from this list, so two people can’t buy the same thing.</p>
              )}
            </div>
          )}

        </div>
      </div>
  );
};

const Fact: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-cream-200 bg-cream-50/60 px-3.5 py-2.5">
    <p className="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">{label}</p>
    <p className="text-[14px] font-bold text-ink-900 mt-0.5 break-words">{value}</p>
  </div>
);

export default SharedProfile;
