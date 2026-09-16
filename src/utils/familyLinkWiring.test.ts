import { readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

/**
 * Linked families — the wiring a rendering test would miss.
 *
 * The allowlist itself is proven in server/familyLink.test.mjs. What is proven
 * HERE is that the panel is actually reachable and that the client never tries
 * to reach the collection directly: familyLinks is denied to every client by
 * firestore.rules, so a component that reached for the Firestore SDK would fail
 * silently at runtime for every family and pass every unit test.
 */
const root = join(import.meta.dirname ?? __dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
/* Comments off before asserting. A guard that forbids a word is otherwise
 * tripped by the comment explaining WHY the word is forbidden — which has
 * now happened three times in this file. */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const dash = read('src/components/Dashboard.tsx');
const panel = read('src/components/ConnectedFamilies.tsx');
const api = read('src/utils/familyLink.ts');

let n = 0;
const check = (label: string, cond: boolean) => {
  assert.ok(cond, `FAILED: ${label}`);
  n++;
};

// Reachable at all — a modal nobody can open is not a feature.
check('Dashboard imports the panel', dash.includes("import ConnectedFamilies from './ConnectedFamilies'"));
check('Dashboard mounts it', /<ConnectedFamilies\b/.test(dash));
check('Dashboard has a control that opens it', dash.includes('setConnectedOpen(true)'));
check('the control is NOT gated on isAdmin — children want to see their cousins',
  !/isAdmin && \(\s*<button[^]{0,400}setConnectedOpen\(true\)/.test(dash));

// The whole feature goes through the server. If this ever changes, the client
// is asking Firestore for a collection the rules deny.
check('the panel never touches the Firestore SDK', !/firebase\/firestore/.test(panel));
check('the api module never touches the Firestore SDK', !/firebase\/firestore/.test(api));
for (const route of ['/api/family-link/list', '/api/family-link/create', '/api/family-link/accept',
  '/api/family-link/share', '/api/family-link/profiles', '/api/family-link/revoke']) {
  check(`api calls ${route}`, api.includes(route));
}

// Every route the client calls must exist on the server, and vice versa.
const server = read('server.js');
for (const route of ['list', 'create', 'accept', 'share', 'profiles', 'revoke']) {
  check(`server implements /api/family-link/${route}`,
    new RegExp(`app\\.(get|post)\\('/api/family-link/${route}'`).test(server));
}

// SharedMember must not be a Partial<FamilyMember>: that would widen silently
// every time FamilyMember grew a field and would let a component read
// `member.medical` because the type said it might be there.
check('SharedMember is its own narrow type, not a Partial of FamilyMember',
  /export interface SharedMember \{/.test(api)
  && !/interface SharedMember extends/.test(api)
  && !/SharedMember\s*=\s*Partial</.test(api));

// The admin-only actions must actually be admin-only in the UI too. The server
// enforces it regardless; this catches a panel that offers a button that will
// always fail.
check('connect/share/disconnect controls sit behind isAdmin', panel.includes('{isAdmin &&'));

// The panel has to say what crosses. This is the one claim a person acts on.
check('the panel names what is never shared', /documents, ID numbers, medical/.test(panel));

// The ASSISTANT has to know the feature exists. Shipping a feature the AI has
// never heard of is its own bug class in this app: asked "how do I add my
// sister's family", it happily offered to create new_member profiles for the
// nieces and nephews inside THIS household — a stale copy, and exactly what
// connected families was built to avoid. The prompt must name the feature and
// must forbid that answer.
check('the AI prompt tells the assistant connected families exists',
  /Connected families/.test(server) && /CONNECTED FAMILIES/.test(server));
check('the AI prompt forbids answering it with new_member',
  /NEVER answer this with "new_member"/.test(server));
check('the AI prompt gives the real click path',
  /People -> Profiles/.test(server) && /Connect another family/.test(server));
check('the AI prompt offers extended_birthday as the lighter option',
  /use "extended_birthday" and say so/.test(server));

// A cached empty list is indistinguishable from "they have shared nobody", and
// there is no signal here when the other household ticks a name. Rory hit this
// for real: he expanded the row before the other family had shared anyone, and
// the panel kept showing an empty list afterwards.
check('expanding a link refetches rather than serving a cached list',
  !/if \(profiles\[link\.id\]\) return;/.test(panel));
check('a refetch does not blank the list while it loads',
  /if \(!profiles\[link\.id\]\) setProfilesBusy/.test(panel));

// WHERE THE OPENER LIVES. Twice wrong now. As a SIBLING of the family list it
// picked up `.ember-people-directory > .card { position: sticky }` and covered
// the list; moved above the list and un-stuck, it scrolled out of reach and
// Rory saw nothing at all. It belongs INSIDE the card that pins, so it travels
// with the list. Anchor the assertion structurally, not visually.
const listCardStart = dash.indexOf('data-tour="family-list"');
const opener = dash.indexOf('setConnectedOpen(true)');
// Bound it by the member list itself, not by a far-away comment: the opener
// has to sit between the card's opening tag and the <Reorder.Group> of people.
// A looser window (up to "Selected member detail") passed even with the opener
// moved back outside the card, which is the exact regression being guarded.
const memberList = dash.indexOf('<Reorder.Group');
// v312 moved it BELOW the people at Rory's request ("the extended family
// should be at the bottom of the profile pack"). What has been wrong three
// times is never the side of the list — it is leaving the CARD. Assert the
// containment, which is the property that actually broke, and leave the order
// to taste.
const cardEnd = dash.indexOf('{/* Selected member detail */}');
check('the connected section is inside the family list card, with the people',
  listCardStart > -1 && memberList > -1 && opener > listCardStart && opener < cardEnd);
check('and it is below the people, not above them', opener > memberList);
check('the opener no longer carries the .card class that the sticky rule catches',
  !/setConnectedOpen\(true\)[\s\S]{0,200}className="card /.test(dash));

// The directory's sticky rule must be anchored to the family list itself.
// As `> .card` it caught every later sibling using .card.
const css = read('src/index.css');
check('only the family list is sticky in the ember directory',
  /\.ember-people-directory > \[data-tour="family-list"\] \{ position: sticky/.test(css));
check('the blanket sibling selector is gone',
  !/\.ember-people-directory > \.card \{ position: sticky/.test(css));

// REVERSED, deliberately. This block used to assert the opposite:
//
//   check('a single connected family expands on its own',
//     /if \(active\.length === 1\) void handleOpen\(active\[0\]\)/.test(panel));
//
// which came from Rory hitting a card that needed a tap to open and a tap to
// close, so with one connected family the first tap only ever hid something.
// Auto-expanding on a count of exactly one was the fix.
//
// It was the wrong fix, and he said so later: the panel should be collapsed on
// mount, full stop. Keying the default off how many households happen to be
// connected means the screen behaves one way for a family with a single link
// and another way the day they add a second — the same screen, quietly
// different, for a reason nobody can see. ConnectedInline.tsx carried the same
// effect keyed on `links.length` and both were removed together.
//
// The assertion is not simply deleted, because a deleted assertion is
// invisible and the next person to read the old complaint would put the effect
// straight back. It is inverted, so the file states which way round the
// behaviour is meant to be. The full guard, with its controls, lives in
// connectedInlineCollapse.test.ts.
check('a single connected family does NOT auto-expand — collapsed is the unconditional default',
  !/if \(active\.length === 1\) void handleOpen\(active\[0\]\)/.test(panel));
// CONTROL: the pattern above still matches the shape it was written against,
// so the inverted check is passing because the code changed and not because
// the regex rotted against a reflow or a rename.
check('control: the old auto-expand shape IS still matchable',
  /if \(active\.length === 1\) void handleOpen\(active\[0\]\)/.test(
    'if (active.length === 1) void handleOpen(active[0]);'));

// ---------------------------------------------------------------------------
// v310 — THE PEOPLE THEMSELVES, IN THE DIRECTORY, OPENING A REAL PROFILE.
// Rory: "why cant it just open like the normal profiles... it should be a line
// under your family, then you click and expands all the other profiles" and
// "can it open up as a proper profile where you can click around, albeit
// restricted info, but at least it looks familiar". Behind a modal and a second
// tap, a cousin is a cousin nobody finds.
const inline = read('src/components/ConnectedInline.tsx');
const profile = read('src/components/SharedProfile.tsx');

check('the directory lists connected people itself, not just a modal opener',
  /<ConnectedInline[\s\S]{0,80}onManage=/.test(dash));
const inlineAt = dash.indexOf('<ConnectedInline');
check('it sits inside the family list card, under the people',
  inlineAt > listCardStart && inlineAt > memberList && inlineAt < cardEnd);
check('the admin actions still reach the full panel',
  /onManage=\{\(\) => setConnectedOpen\(true\)\}/.test(dash));
check('a shared person opens a profile rather than expanding in place',
  /onOpenPerson/.test(inline) && /onOpen: \(\) => void/.test(inline));
check('the profile is reachable only with a member and its household name',
  /householdName=\{sharedView\.household\}/.test(dash));

// THE PROJECTION IS THE WHOLE SECURITY BOUNDARY. A profile screen that reads a
// field the server never sends is not a bug you would see — it renders blank
// today and leaks the day somebody widens the projection. So the screen may
// only touch keys that SharedMember actually declares.
const linkSrc = read('src/utils/familyLink.ts');
// Cut at the interface's OWN closing brace — column 0 — not at the first `}`
// after some field name. That older cut worked only while `favorites` was the
// last field; the moment SharedMember grew a nested object below it the slice
// ended early and started reporting real declared fields as strays.
const ifaceStart = linkSrc.indexOf('interface SharedMember');
const iface = linkSrc.slice(ifaceStart, linkSrc.indexOf('\n}', ifaceStart));
const declared = new Set(Array.from(iface.matchAll(/^\s{2}(\w+)\??:/gm)).map((m) => m[1]));
const touched = Array.from(profile.matchAll(/\bmember\.(\w+)/g)).map((m) => m[1]);
const strayFields = touched.filter((f) => !declared.has(f));
check(`the profile reads only projected fields (stray: ${strayFields.join(', ') || 'none'})`,
  declared.size > 4 && strayFields.length === 0);

// It is READ-ONLY by construction: another household's person has no edit path
// here, and offering one would fail silently against the rules.
for (const writer of ['onUpdate', 'persistChanges', 'setDoc', 'updateDoc', 'onSave']) {
  check(`the shared profile never offers to write (${writer})`, !profile.includes(writer));
}

// Rat1 shares a name, a role and a birthday and nothing else. Tapping him did
// nothing at all, which reads as broken rather than as sparse. Both the row and
// the profile must SAY what is not there.
check('a person with nothing else still gets a subtitle', /'Name only'/.test(inline));
/* v320: this was a whole TAB — the loudest thing on a cousin's profile and
 * the first thing anybody clicked. Rory: "lets remove the not shared button".
 * The reassurance it carried is real, so the guard follows it to where it now
 * lives — one line at the bottom of Overview — rather than being deleted with
 * the tab. What must survive is the CONTENT, not the destination. */
check('the profile still names what stays behind in the other household',
  /Documents, ID numbers, contact details, schooling and finances stay with them/.test(profile));
check('and says it can change, on both sides',
  /they can change what crosses at any time/.test(profile)
  && /Connected families → Manage/.test(profile));
check('but it is no longer a tab of its own',
  !/'private'/.test(profile) && !/label: 'Not shared'/.test(profile));

// Same visual vocabulary as a member — that was the whole request.
for (const token of ['avatar-ring', 'tab-pill', 'chip bg-cream-200']) {
  check(`the profile uses the member panel's ${token}`, profile.includes(token));
}

// ---------------------------------------------------------------------------
// v311 — CHOOSING WHAT CROSSES, AND NAMING SOMEBODY IN THE OTHER HOUSEHOLD.
// Rory: "i think they should be able to choose what they see and we should
// include will as well so designate this person as bla bla?"
const linkMod = read('server/familyLink.mjs');
const routes = server;
const linkApi = read('src/utils/familyLink.ts');
const wills = read('src/components/WillsEstateView.tsx');
const SHARE_RUNG_IDS = ['fact', 'instructions', 'documents'];
const types = read('src/types.ts');

// The client list and the server list are two copies of one decision. Drift
// means a chip that turns nothing off — the worst kind of privacy control.
/* Matched on `id:` alone, inside the SHARE_CATEGORIES array only. The old
 * pattern required id/label/fields on ONE line, so a category written as a
 * multi-line object with a comment — which every opt-in one is, because each
 * has to explain itself — was silently invisible to this guard and drift
 * would have gone unnoticed in exactly the entries that matter most. */
const catIds = (src: string, start: string, end: string) =>
  Array.from(src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)))
    .matchAll(/^\s*(?:\{\s*)?id: '(\w+)',/gm)).map((m) => m[1]);
const serverCats = catIds(linkMod, 'export const SHARE_CATEGORIES = [', '\nconst CATEGORY_IDS');
const clientCats = catIds(linkApi, 'export const SHARE_CATEGORIES: Array<', '\nexport const ALL_SHARE_CATEGORIES');
check(`the category lists match (server: ${serverCats.join('|')}, client: ${clientCats.join('|')})`,
  serverCats.length >= 7 && serverCats.join(',') === clientCats.join(','));
check('the union type lists exactly those categories',
  serverCats.every((c) => new RegExp(`'${c}'`).test(linkApi.slice(linkApi.indexOf('export type ShareCategory')))));

// THE DIAL MUST REACH THE READ. A saved category that the profiles route never
// consults is a setting that lies.
check('the read projects per person, not per link',
  /projectSharedMember\(\{ id: s\.id, \.\.\.s\.data\(\) \}, categoriesFor\(link, other\.id, s\.id\), surnameMeanings\)/.test(routes));
/* Still the same rule, but against `effective` — the ids that ACTUALLY cross
 * after the mode is applied — not the raw ticked list. In 'everyone' mode
 * those differ, and validating against the wrong one would leave a category
 * rule behind for somebody who is excluded. */
check('the write validates categories against the ids that actually cross',
  /const effective = mode === 'everyone'/.test(routes)
  && /sanitizeShareFields\(\(req\.body \|\| \{\}\)\.shareFields, effective\)/.test(routes));
check('the picker only shows the dial for somebody actually shared',
  /\{on && \([\s\S]{0,400}SHARE_CATEGORIES\.map/.test(panel));
check('un-sharing a person drops their categories too',
  /if \(on\) delete fields\[memberId\];/.test(panel));
/* Three dials now, still one save. The server REPLACES the whole per-side map
 * on every call, so a save that left the mode out would reset it. */
check('who, what and how are saved together, never one without the others',
  /setFamilyLinkShare\(link\.id, ids, fields, mode\)/.test(panel));
check('the admin is told the name always crosses',
  /Their name is always shared/.test(panel));

// NAMING SOMEBODY IN A CONNECTED HOUSEHOLD.
check('the successor record can point at a connected household',
  /fromLinkId\?: string;/.test(types) && /sharedMemberId\?: string;/.test(types));
check('the picker offers connected people as well as our own',
  /connectedPeople\.map\(c => \([\s\S]{0,200}datalist|connectedPeople\.map\(c => \(/.test(wills));
check('our own family wins a name clash',
  /matched \? undefined : connectedPeople\.find/.test(wills));
check('the card says naming is not access',
  /naming them is not access/.test(wills));

/* THE FACT CROSSES BY DEFAULT; EVERY RUNG ABOVE IT IS CHOSEN.
 * Until v317 the instructions never crossed at all, because whatTheyShouldDo
 * is free text in another household's estate document and can hold a safe
 * combination. It can now cross — but only because the household that WROTE
 * it climbed the ladder deliberately, and only through one projection. The
 * route itself must still never touch an estate field by name. */
const designation = routes.slice(routes.indexOf('async function designationFor'),
  routes.indexOf('function linkForClient'));
check('the designation is projected by the boundary module, not inline in a route',
  /return projectDesignation\(succ, ours, other\.name \|\| '', estate\.records\)/.test(designation));
const designationCode = designation.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
check('the route never reads an estate field by name',
  !/whatTheyShouldDo|originalLocation|notaryPhone|heldBy/.test(designationCode));
check('a designation only crosses on a link that is actually active',
  /link\?\.status !== 'active'/.test(designation) && /succ\.fromLinkId !== link\.id/.test(designation));
check('they may only name somebody we actually share with them',
  /ourSharedIds\.includes\(succ\.sharedMemberId\)/.test(read('server/familyLink.mjs')));
check('a failed designation read does not cost the caller their cousins',
  /designation read failed/.test(designation) && /return null;\s*\n\s*\}\s*\n\}/.test(designation));
check('the named household is told', /named\[link\.id\]/.test(inline)
  && /named \{who\} to help with their estate/.test(read('src/components/NamedByThemCard.tsx')));

// ---------------------------------------------------------------------------
// v312 — THEIR OWN FACE ON THE ROW. Rory: "the rat family photo can be there if
// there is one". A household name with no face is the least recognisable thing
// in a list of families.
check('the other household\'s photo crosses', /otherPhotoUrl/.test(routes) && /otherPhotoUrl/.test(inline));
// INLINE DATA ONLY. A Storage download URL is a capability, not a picture, and
// a remote URL would make every viewer's browser fetch from wherever it pointed.
check('only an inline data image is accepted',
  /url\.startsWith\('data:image\/'\)/.test(routes));
check('and it is size-capped', /url\.length < \d+/.test(routes));
check('a missing photo falls back to the link icon rather than a broken image',
  /photos\[link\.id\] \? \([\s\S]{0,200}<img/.test(inline) && /<Link2 className/.test(inline));
check('a failed photo read does not cost the caller their cousins',
  /photo read failed/.test(routes));

// ---------------------------------------------------------------------------
// v313 — IT OPENS WHERE A PROFILE OPENS. Rory: "i want it to open normally like
// the other profiles not a new modal", after seeing his OWN avatar painted over
// the modal. Root cause: the modal was rendered inside the family-list card,
// which is `position: sticky` under Ember, and sticky creates a stacking
// context — so z-[120] resolved inside that card and the member panel, later in
// the DOM, won. Rendering it where the member panel renders removes the class
// of bug entirely rather than out-stacking it.
check('the shared profile is not a modal',
  !/fixed inset-0/.test(profile) && !/createPortal/.test(profile));
check('it renders in the member detail panel', /<SharedProfile/.test(dash));
const detailPanel = dash.indexOf('{/* Selected member detail */}');
check('and it is that panel, not somewhere that merely mentions it',
  dash.indexOf('<SharedProfile') > detailPanel);
// One panel, one subject: picking either must drop the other, or the screen
// shows a cousin while the list highlights a member. (linkId rides along so
// the profile can offer "Hide <name>'s dates" for that link's person.)
check('opening a cousin is exclusive with a selected member',
  /setSharedView\(\{ member: m, household, linkId \}\)/.test(dash)
  && /setSelectedMemberId\(member\.id\); setSharedView\(null\)/.test(dash));
// Assert the BEHAVIOUR, not the comment explaining it: the shared person may
// only ever be handed to SharedProfile. Anywhere else — a member tab, an
// editor, an AI path — would be code assuming a FamilyMember it is not.
const sharedUses = Array.from(dash.matchAll(/sharedView\.member/g)).map((m) => m.index || 0);
const sharedProfileTag = dash.indexOf('<SharedProfile');
const sharedProfileEnd = dash.indexOf('/>', sharedProfileTag);
check(`the shared person reaches only SharedProfile (${sharedUses.length} use(s))`,
  sharedUses.length > 0 && sharedUses.every((i) => i > sharedProfileTag && i < sharedProfileEnd));
check('the open cousin is marked in the list', /openPersonId/.test(dash) && /selected \? 'border-clay-400/.test(inline));
check('a shared photo opens full size like a member\'s',
  /onViewPhoto\?\.\(member\.avatarUrl!\)/.test(profile) && /cursor-zoom-in/.test(profile));
check('and the lightbox is the app\'s own', /onViewPhoto=\{\(url\) => setLightboxImage\(url\)\}/.test(dash));

// THE ACTIVE TAB WAS INVISIBLE IN DARK MODE. --color-ink-900 IS near-white
// under Ember, so `bg-ink-900 text-white` was white on white — everywhere
// .tab-pill is used, not only here.
check('the active tab pill takes its text from a token that inverts with it',
  /\.tab-pill-active \{[\s\S]{0,600}color: var\(--color-cream-50\)/.test(css));
check('and no longer hard-codes white', !/\.tab-pill-active \{\s*@apply bg-ink-900 text-white/.test(css));

// ---------------------------------------------------------------------------
// v313 — THE PHOTO CONTROL WAS UNREACHABLE. Rory: "i should be able to upload a
// photo for myself and others in the edit section", then "or probably more
// importantly by clicking the profile picker image". Both were true statements
// about a control that HAS existed all along, sitting at the very bottom of a
// fifteen-field modal. A control nobody reaches is a control that does not
// exist — the failure was placement, not capability.
const edit = read('src/components/EditMemberModal.tsx');
const formStart = edit.indexOf('<form onSubmit={handleSaveSubmit}');
const avatarBlock = edit.indexOf('{/* Profile Avatar Selection Section */}');
const nameField = edit.indexOf('Full name');
check('the photo control is the first thing in the edit form',
  formStart > -1 && avatarBlock > formStart && avatarBlock < nameField);
check('all three ways in survive the move',
  /Upload Image/.test(edit) && /Take Snapshot/.test(edit) && /Initials/.test(edit));

// The picture itself is the obvious way in, and Rory said so.
check('an initials circle opens the editor', /Add a photo for \$\{selectedMember\.name\}/.test(dash));
const circleAt = dash.indexOf('Add a photo for');
const gateAt = dash.lastIndexOf('{isAdmin ? (', circleAt);
check('and only for somebody who may edit',
  gateAt > -1 && circleAt - gateAt < 600);
/* v315 replaces the v313 pair of badges. Rory, looking at two 32px circles
 * crowding one avatar: "these to pickers should be smaller and do you think
 * its better to have them open up if you click the photo? how do other apps do
 * it" — they use ONE control that opens a sheet, so this now guards that shape
 * rather than the pair it replaced. */
const menuOpen = dash.indexOf("photoMenuFor === selectedMember.id");
const menuEnd = dash.indexOf('</>', menuOpen);
check('one photo control, not two', menuOpen > -1 && menuEnd > menuOpen);
const menu = dash.slice(menuOpen, menuEnd);
/* "See full size" left the sheet in v316 — it is what tapping the photo does
 * now, and a menu item for a gesture the user already made is the two-press
 * problem written down. */
for (const item of ['Change photo', 'Make a fun avatar']) {
  check(`the sheet offers "${item}" as a labelled item`, menu.includes(`label: '${item}'`));
}
/* Scoped to the avatar hero on purpose: the restyle is also reachable from the
 * edit modal (onOpenFunAvatar), which is a different surface and stays. What
 * must be gone is the second BADGE competing with the camera one. */
const heroStart = dash.lastIndexOf('<div className="relative shrink-0">', menuOpen);
const hero = dash.slice(heroStart, menuEnd);
check('the avatar carries one badge, and the sparkle badge is gone',
  (hero.match(/setRestyleMemberId\(selectedMember\.id\)/g) || []).length === 1
  && !/absolute bottom-0 right-0[\s\S]{0,300}?Sparkles/.test(hero));
/* Rory: "i dont want to have to press twice if i press on the image it must
 * open up the photo if i press on the icon it must open the pickers". */
check('tapping the photo opens the photo, in one press, for everyone',
  /onClick=\{\(\) => setLightboxImage\(selectedMember\.avatarUrl!\)\}/.test(hero)
  && !/isAdmin\s*\n?\s*\? setPhotoMenuFor/.test(dash));
check('and the sheet is reached from the badge, which is the only thing that opens it',
  (hero.match(/setPhotoMenuFor\(selectedMember\.id\)/g) || []).length === 1);
check('the sheet no longer offers what the photo tap already does',
  !menu.includes("label: 'See full size'"));
check('every item in the sheet closes it before acting',
  /setPhotoMenuFor\(null\); run\(\)/.test(dash));
/* A menu that can only be dismissed by choosing something is the lightbox bug
 * again in a smaller box. */
check('and there is a way out without choosing', /onClick=\{\(\) => setPhotoMenuFor\(null\)\}/.test(dash));

/* THE HOUSEHOLD AS A SUBJECT — "i think we should be able to open up the
 * family profle and see somethings collectively". Same panel, same one-subject
 * rule the shared person obeys. */
const house = read('src/components/SharedHousehold.tsx');
check('their photo opens the household, not the toggle',
  /onClick=\{\(\) => void openHousehold\(link\)\}/.test(inline));
check('the household page is not a modal',
  !/createPortal/.test(house) && !/fixed inset-0/.test(house));
check('opening a household clears the person, and a person clears the household',
  /setHouseholdView\(payload\);\s*\n\s*setSharedView\(null\);/.test(dash)
  && /setSharedView\(\{ member: m, household, linkId \}\);\s*\n\s*setHouseholdView\(null\);/.test(dash));
/* The whole point of the file: a summary must not total up facts that were
 * withheld person by person. Only fields already on SharedMember may appear. */
const houseFields = Array.from(house.matchAll(/\bm\.(\w+)/g)).map((x) => x[1]);
/* linkSrc is already read above, at the top of the link-wiring block. */
/* The same declared set the profile guard above uses — one extraction, so the
 * two screens cannot disagree about what SharedMember contains. */
const sharedBody = iface;
const sharedDeclared = declared;
const strays = houseFields.filter((f) => !sharedDeclared.has(f) && f !== 'id');
check(`the household page reads only projected fields${strays.length ? ` — stray: ${strays.join(', ')}` : ` (${houseFields.length} reads)`}`,
  strays.length === 0);

/* ── THE CARE CARD ────────────────────────────────────────────────────────
 * Rory: "if i am looking after my sisters kids i want to be able to see
 * emergency contact info like the baby sitter".
 *
 * server/familyLink.test.mjs proves the BOUNDARY (what may cross). These
 * guard the WIRING (that the client asks for it, shows it, and never implies
 * it is on when it is not). */
const sharedProf = read('src/components/SharedProfile.tsx');
const conn = read('src/components/ConnectedFamilies.tsx');
const serverLink = read('server/familyLink.mjs');

check('care is declared opt-in on both sides of the wire',
  /id: 'care',[\s\S]{0,1400}?optIn: true/.test(serverLink)
  && /id: 'care',[\s\S]{0,1400}?optIn: true/.test(linkSrc));
/* The bug this exists to stop: an absent entry meaning "all", which on the
 * day care shipped would have handed a child's allergies to every household
 * already connected without anybody choosing it. */
check('an absent entry means the DEFAULTS, and care is not one',
  /return Array\.isArray\(set\) \? set : DEFAULT_SHARE_CATEGORIES;/.test(linkSrc)
  && /SHARE_CATEGORIES\.filter\(\(c\) => !c\.optIn\)/.test(linkSrc));

check('the care tab sits right after Overview, not behind Sizes and Wish list',
  sharedProf.indexOf("id: 'care' as TabId") < sharedProf.indexOf("id: 'sizes' as TabId"));
/* This guard used to read "only when something actually crossed", which was
 * the right INTENT expressed through the only signal available at the time.
 * v322 gave the client a better one: the tab exists when the family switched
 * `care` ON, empty or not, so a minder is never left guessing whether the
 * blank screen means "no allergies" or "not shared". What must still never
 * happen is the tab appearing for a family that did NOT switch it on — that
 * is the part worth guarding, and `shows('care', ...)` is where it lives. */
check('the care tab exists only when the family switched care on',
  /shows\('care', showCare\) \? \[\{ id: 'care'/.test(sharedProf)
  && /hasSharedCare\(member\)/.test(sharedProf));
check('the emergency number is a tel: link, not text to retype',
  /href=\{member\.emergencyContactPhone \? `tel:/.test(sharedProf));
/* "Not shared" claiming allergies never cross, on a screen showing allergies,
 * would make every other line on that list untrustworthy too. */
/* v320 removed the "Not shared" tab, which is the structural fix for this:
 * the old list enumerated categories and had to be kept in step with which
 * ones could actually cross, and it got that wrong the moment `care` shipped.
 * The one line that replaced it names only things that can NEVER cross, so
 * there is nothing left to fall out of step. */
/* Bounded to the footer PARAGRAPH, not to end-of-file. Slicing to EOF was a
 * lazy stand-in that worked only while nothing below it mentioned health —
 * v322's empty care tab says "not the same as no allergies", which is the
 * opposite of the mistake this guards, and tripped it. */
const footer = sharedProf.slice(
  sharedProf.indexOf('This is what {householdName'),
  sharedProf.indexOf('</p>', sharedProf.indexOf('This is what {householdName')),
);
check('the footer paragraph was actually found', footer.length > 80 && footer.length < 700);
check('nothing the footer calls withheld is a category that can actually cross',
  !/Medical records|allergies|Their picture|Birthday/.test(footer));
check('health reads differently from a shoe size in the picker',
  /c\.optIn/.test(conn) && /allergies,\s*\n\s*medicines and emergency number/.test(conn));

/* ── GENDER ───────────────────────────────────────────────────────────────
 * It used to ride across the link with the name, under "identity always
 * crosses", and nothing on the far side ever used it. */
check('gender does not cross to a connected family at all',
  !/^\s{2}gender\??:/m.test(sharedBody)
  && !/gender/.test(sharedProf)
  && !/'gender',/.test(serverLink.split('NEVER_SHARE_MEMBER_FIELDS')[0]));
check('and the field says why it is asked for, so it is not a demographic box',
  /Only used when you export a family tree/.test(read('src/components/EditMemberModal.tsx')));

/* ── NEW MEMBERS CROSSING ─────────────────────────────────────────────────
 * Rory: "all these new members and none show up on the other family". */
const serverJs = read('server.js');
check('the client sends the mode instead of letting the server infer it',
  /body: JSON\.stringify\(\{ linkId, memberIds, shareFields, shareMode \}\)/.test(linkSrc)
  && /SHARE_MODES\.includes\(rawMode\) \? rawMode : shareModeFor\(link, caller\.familyId\)/.test(serverJs));
/* In 'everyone' mode the ticked boxes are the NOT-excluded, so writing them
 * into `share` would look right and change nothing next time a baby is born. */
check('ticking in everyone-mode writes the EXCLUSIONS, under their own key',
  /shareExclude: \{ \[caller\.familyId\]: excluded \}/.test(serverJs)
  && /const excluded = mode === 'everyone' \? validIds\.filter/.test(serverJs));
check('a new link starts at everyone, on both sides',
  (serverJs.match(/shareMode: \{ \[caller\.familyId\]: 'everyone' \}/g) || []).length === 2);
check('the profiles endpoint resolves their side live, not from the stored list',
  /resolveSharedIds\(link, other\.id, theirIds\)/.test(serverJs));
/* The screen that answers "why can't they see the baby?" — before this the
 * fact only existed as the gap between two numbers on two screens. */
check('an admin is told, in words, how many of their family cannot be seen',
  /members\.length > link\.sharedByMe\.length/.test(conn)
  && /cannot see\./.test(conn)
  && /Share everyone, and keep it that way/.test(conn));
check('and switching back to picking freezes the list rather than emptying it',
  /const ids = mode === 'everyone' \? members\.map\(\(m\) => m\.id\) : link\.sharedByMe;/.test(conn));


/* ── THE WILL LADDER ──────────────────────────────────────────────────────
 * Rory: "build the will thing steps". Naming a cousin as your successor is
 * one thing; telling them is another, and telling them WHAT is a third. The
 * boundary (which estate fields may cross at each rung) is proven in
 * server/familyLink.test.mjs. These prove the ladder is reachable, that the
 * rung you set is the rung that travels, and that it arrives unasked. */
/* `wills` and `inline` are already read above — reused, not re-read. */
const household = read('src/components/SharedHousehold.tsx');
const namedCard = read('src/components/NamedByThemCard.tsx');

check('the ladder only appears for a successor who is in a CONNECTED family',
  /successor\.fromFamilyName && canWrite && \(\s*\n\s*<SuccessorShareLadder/.test(wills));
/* Rungs, not switches: "and what you want them to do" is meaningless without
 * "that you named them", so four independent checkboxes would let a family
 * build a state the reader cannot render. */
const ladderSrc = wills.slice(wills.indexOf('const SHARE_RUNGS'), wills.indexOf('function SuccessorCard'));
check('the rungs are a single choice, not three independent tick boxes',
  /aria-pressed=\{on\}/.test(ladderSrc) && !/type="checkbox"/.test(ladderSrc)
  && /const on = rung\.id === level;/.test(ladderSrc));
/* Each rung states the CONSEQUENCE, not the level. "instructions" is not a
 * sentence anybody can agree or disagree with; "she can read what you want
 * her to do" is. */
check('each rung names who sees what, not an abstract level',
  SHARE_RUNG_IDS.every((id) => new RegExp(`id: '${id}',[\\s\\S]{0,120}?detail: \\(who\\)`).test(ladderSrc)));
check('choosing a rung stamps WHEN, so the far side can say how old the wish is',
  /shareLevel: next,\s*\n\s*shareLevelSetAt: new Date\(\)\.toISOString\(\),/.test(wills));
check('and the page stops claiming naming them is the end of it',
  /You choose below how much they are told\./.test(wills));

/* The notification. A fact you only learn by opening the right household and
 * scrolling is not one — so it rides on /list, which every panel already
 * calls, as well as on /profiles. */
check('being named arrives on the LIST, not only deep inside a household',
  /namedByThem: await designationFor\(l, other, caller\.familyId\)/.test(serverJs)
  && /const namedByThem = await designationFor\(link, other, caller\.familyId\)/.test(serverJs));
check('the client type carries the rung and what arrived with it',
  /level\?: SuccessorShareLevel/.test(linkSrc)
  && /documents\?: Array<\{ kind: string; lastReviewed\?: string \}>/.test(linkSrc));

/* ONE renderer for both places it shows. Two copies is how the compact card
 * ends up saying "no instructions given" while the full card correctly says
 * nothing at all — an absent field means it did not cross, never that it is
 * empty, and that rule has to live in exactly one file. */
check('both the inline card and the household page render the same component',
  /<NamedByThemCard\b/.test(inline) && /<NamedByThemCard\b/.test(household)
  && /import NamedByThemCard from '\.\/NamedByThemCard'/.test(inline)
  && /import NamedByThemCard from '\.\/NamedByThemCard'/.test(household));
/* Strip the comments first: the file EXPLAINS the rule it obeys, and a bare
 * grep flagged its own explanation. What must be absent is the rendered
 * claim, not the word. */
const namedCardCode = namedCard.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
check('and that component never says why something is missing',
  !/not shared|didn.t share|no instructions|nothing to show|withheld/i.test(namedCardCode));

/* ── STALE CONNECTED DATA ─────────────────────────────────────────────────
 * Rory: "there needs to be a refresh button ... i had to close it". The v308
 * bug — serve the cache and return without refetching — had come back in
 * openHousehold, so a household you had opened once never updated again. */
check('there is a labelled Refresh control, not a bare icon',
  /RefreshCw/.test(inline) && /\{refreshing \? 'Checking…' : 'Refresh'\}/.test(inline));
check('coming back to the app refetches, so it is fresh without being asked',
  /visibilitychange/.test(inline) && /document\.visibilityState === 'visible'/.test(inline));
check('opening a cached household shows it AND refetches behind it',
  /void refreshAll\(\);/.test(inline.slice(inline.indexOf('openHousehold'))));

/* ── COPY THAT KNOWS WHAT IT KNOWS ────────────────────────────────────────
 * Rory: "it says i have n shared sizes or wish list but i have not". The
 * receiving side genuinely cannot tell a switched-off category from an empty
 * one, so it must not word either as the other. */
/* v320: the sentence this guarded is gone, because the Overview it sat on is
 * no longer a list of absences — it leads with the star sign, what the name
 * means and the name days. The rule it protected still binds every line that
 * replaced it: this side cannot tell a switched-off category from an empty
 * one, so nothing on the profile may word either as the other. */
check('the profile never explains an absence it cannot actually see',
  !/have not shared|chose not to share|withheld|switched off/i.test(sharedProf));


/* ── A COUSIN WHO IS A PERSON ─────────────────────────────────────────────
 * Rory: shared profiles are "just boring at the moment" — they should carry
 * the star sign, the name day and what the name means. Three different
 * mechanisms, and the difference between them is the interesting part. */

/* THE STAR SIGN CROSSES NOTHING. It is a pure function of the birthdate, so
 * it is derived on the receiving side — which means no field, no switch, and
 * no way to end up with "sign shared, birthday not", a state nobody could
 * honour. */
check('the star sign is derived, never projected',
  /sunSign\(member\.birthdate\)/.test(sharedProf)
  && !/'sunSign'|starSign|zodiac/.test(serverLink));
/* Strip the comments before asserting: the block's own explanation SAYS
 * "the star sign is not here", and a guard that reads its own reasoning as
 * a violation is the third time this has bitten me. */
check('so it is absent exactly when the birthday is',
  !/sign/i.test(strip(serverLink.slice(serverLink.indexOf('export const SHARE_CATEGORIES'),
    serverLink.indexOf('const CATEGORY_IDS')))));

/* NAME DAYS ARE OPT-IN, and for a stated reason. A feast day names a
 * religion; that is Art. 9 data, the same article behind `care`. */
/* ONE category, not "somewhere after it". `care` is also opt-in and sits a
 * few hundred characters below, so a lazy [\s\S]{0,1600}? match sailed past
 * celebrations and found CARE's optIn — the guard passed with the flag
 * deleted. Slice the single object instead. */
const oneCat = (src: string, id: string) => {
  const from = src.indexOf(`id: '${id}'`);
  if (from < 0) return '';
  const next = src.indexOf("id: '", from + 8);
  return src.slice(from, next < 0 ? src.length : next);
};
check('name days are opt-in on both sides',
  /optIn: true/.test(oneCat(serverLink, 'celebrations'))
  && /optIn: true/.test(oneCat(linkSrc, 'celebrations')));
check('and the reason given is the religion one, not squeamishness',
  /Art\. 9/.test(oneCat(serverLink, 'celebrations')));
check('while what their name means is not opt-in — and neither guard is reading the other category',
  !/optIn/.test(oneCat(serverLink, 'about'))
  && oneCat(serverLink, 'celebrations').length > 100
  && oneCat(serverLink, 'about').length > 60);
check('an unconfirmed celebration never crosses — proposing a religion is worse than silence',
  /c\.confirmed === true/.test(serverLink));
check('whether THEY get a reminder is not a fact about the person',
  /'source', 'confirmed', 'notify'/.test(serverLink));

/* NAME MEANINGS ARE A DEFAULT, and that decision is written down rather than
 * skipped — the test is "would they be upset", not "is it new". */
check('name meanings are a default, with the test shown being applied',
  /id: 'about',[\s\S]{0,900}?would a household be upset/i.test(serverLink)
  && !/id: 'about',[\s\S]{0,900}?optIn: true/.test(serverLink));
check('only confirmed meanings cross', /m\.confirmed === true/.test(serverLink));
check('the citation they paid for stays with them',
  /'id', 'source', 'confirmed', 'key'/.test(serverLink));
/* THE HEDGE IS THE FIELD. types.ts: every surface rendering a meaning must
 * render the confidence beside it, or the app is asserting folk etymology as
 * fact about somebody else's family. */
check('confidence crosses and cannot be dropped',
  /'confidence',\s*\n?\]/.test(serverLink)
  && /if \(!\['established', 'likely', 'contested'\]\.includes\(out\.confidence\)\)/.test(serverLink));
check('and the shared profile renders it beside every meaning',
  /confidenceLabel\(m\.confidence\)/.test(sharedProf));

/* THE SURNAME. Held once per space, so without folding it in a shared
 * profile explains the first name and says nothing about the family name. */
check('the household surname is folded in per member, not projected separately',
  /mergeNameMeanings\(member, surnameMeanings\)/.test(serverLink)
  && /surnameMeanings\[\]|let surnameMeanings = \[\];/.test(serverJs));
check('and a failed surname read does not cost the caller their cousins',
  /profiles surname read failed/.test(serverJs));
check('the member\'s own entry wins over the household one for the same token',
  /const mine = new Set\(own\.map/.test(serverLink));

/* ONE RESOLVER. A name day resolved twice is a second answer waiting to
 * disagree with the one its own family sees. */
check('the shared side runs the same celebrations resolver, not its own',
  /resolveCelebrations\(\{/.test(sharedProf)
  && !/nameDayFor|resolveSharedNameDay/.test(sharedProf));


/* ── WHAT THEY LIKE ───────────────────────────────────────────────────────
 * Rory: "hobbies and other things like favourite colours ... especially for
 * families connected so they know what presents or gifts to buy". The fields
 * already existed and simply never crossed. */

check('the gift category exists on both sides and is a default',
  /id: 'interests'/.test(serverLink) && /id: 'interests'/.test(linkSrc)
  && !/optIn/.test(oneCat(serverLink, 'interests')));

/* THE CARVE-OUT IS THE WHOLE DESIGN. A restriction reading "coeliac" is a
 * diagnosis and one reading "halal" is a religion; neither may ride in a
 * category that is on by default. */
check('dietaryRestrictions is NOT in the default gift set',
  !/dietaryRestrictions/.test(strip(serverLink).slice(
    strip(serverLink).indexOf('const SHAREABLE_PREFERENCE_FIELDS'),
    strip(serverLink).indexOf('const CARE_ONLY_PREFERENCE_FIELDS'))));
check('it is classified rather than merely omitted — an unlisted field is an accident',
  /CARE_ONLY_PREFERENCE_FIELDS = \['dietaryRestrictions'\]/.test(serverLink));
check('and it rides with care, which is opt-in and already carries allergies',
  /on\.has\('care'\)[\s\S]{0,900}?CARE_ONLY_PREFERENCE_FIELDS/.test(serverLink));
check('care MERGES onto preferences rather than clobbering the gift fields',
  /out\.preferences = \{ \.\.\.\(out\.preferences \|\| \{\}\), \.\.\.care \}/.test(serverLink));
check('the reason is written down where the list is, not just in a commit',
  /Art\. 9/.test(serverLink.slice(serverLink.indexOf('WHAT THEY LIKE'),
    serverLink.indexOf('const SHAREABLE_PREFERENCE_FIELDS'))));

/* Free text from another household, rendered on your phone. */
check('every preference string is capped', /PREFERENCE_TEXT_CAP = \d+/.test(serverLink)
  && /slice\(0, PREFERENCE_TEXT_CAP\)/.test(serverLink));
check('a non-string is dropped, never stringified',
  /if \(typeof v !== 'string'\) continue;/.test(serverLink));

/* THE ENTRY POINT. Making it a default is only honest if the person typing
 * it is told there, not only in a panel they never open. */
const prefsUi = read('src/components/MemberPreferences.tsx');
check('the editor says connected families can read this', /Connected families can read this/.test(prefsUi));
check('and names the dietary exception at the point of entry',
  /Dietary restrictions[\s\S]{0,120}?exception/i.test(prefsUi));

check('the shared profile shows it as its own tab, beside Sizes and Wish list',
  /id: 'likes' as TabId, label: 'What they like'/.test(sharedProf));
/* v321 said "a person who filled nothing in gets no empty tab". v322 REVERSES
 * that on purpose — Rory: "if there is nothing to show it must say so and so
 * hasnt filled it yet" — because a hidden empty tab made a working feature
 * look missing. What survives is the half that was never about emptiness: a
 * family that did not switch `interests` on gets no tab at all. */
check('a family that did not switch interests on gets no tab',
  /shows\('interests', likes\.length > 0\) \? \[\{ id: 'likes'/.test(sharedProf));
check('and an empty one that IS switched on says so rather than hiding',
  /likes\.length === 0 && <NothingYet/.test(sharedProf));
check('the restriction is labelled as one, not as a favourite',
  /\['dietaryRestrictions', 'Must avoid'\]/.test(sharedProf));


/* ── EMPTY, OR NOT SENT? ──────────────────────────────────────────────────
 * Rory, twice, from opposite directions: "it says i have no shared sizes or
 * wish list but i have not not shared" and later "there must be wishlist and
 * all other possible things to show BUT if there is nothing to show it must
 * say so and so hasnt filled it yet". Only the server can tell the two apart,
 * so it now says which switches are on. */
check('the server tells the far side which categories are on',
  /out\.sharedCategories = CATEGORY_IDS\.filter\(\(c\) => on\.has\(c\)\)/.test(serverLink));
check('and the disclosure that buys is written down, not glossed',
  /WHAT THIS DISCLOSES/.test(serverLink));
check('the client types it as possibly absent, so old payloads are handled',
  /sharedCategories\?: ShareCategory\[\]/.test(linkSrc));

/* THE WHOLE POINT: an empty state may only be drawn where a switch is ON. */
check('tabs follow the switch, not the data', /const shows = \(cat: ShareCategory, hasData: boolean\)/.test(sharedProf));
check('and a payload with no list falls back to data-presence rather than inventing switches',
  /onCats \? onCats\.includes\(cat\) : hasData/.test(sharedProf));
check('every gift tab is switch-driven',
  /shows\('interests'/.test(sharedProf) && /shows\('sizes'/.test(sharedProf)
  && /shows\('wishes'/.test(sharedProf) && /shows\('care'/.test(sharedProf));
check('the empty state says the family DOES share it — the absence is the field, not the decision',
  /there is just nothing in it so far/i.test(sharedProf));

/* THE CARE TAB IS NOT ALLOWED THE CHEERFUL VERSION. Somebody reading it is
 * about to mind a child, and "no medical details yet" is one step from "so
 * no allergies". */
check('an empty care tab refuses the no-allergies reading',
  /That is not the same as .no allergies/.test(sharedProf));
check('and it names the only reliable move',
  /ask \{householdName \|\| 'their household'\} directly/.test(sharedProf));
check('care does not reuse the ordinary empty card',
  !/NothingYet what="medical|NothingYet what="care/.test(sharedProf));

check('name days show when the family toggled them on, empty or not',
  /shows\('celebrations', namedays\.length > 0\)/.test(sharedProf));
check('and an opt-in category still never appears unasked',
  /optIn: true/.test(oneCat(serverLink, 'celebrations')));

console.log(`familyLinkWiring.test.ts: ${n} assertions passed.`);
