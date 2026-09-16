/* Standalone assertions — npx tsx src/utils/inboundMailWiring.test.ts
 *
 * WHAT IS BEING GUARDED. A family's inbound address is not a display string:
 * anyone holding it can write documents into that family's vault by sending an
 * email. That is why the address is an HMAC of the family id and a server
 * secret, and why the endpoint that hands it out is member-only. It also means
 * the address is UNGUESSABLE BY DESIGN — nobody can use this feature unless
 * the app shows them the address, so the server pipeline and the one row of UI
 * that displays it are a single feature, not two.
 *
 * Every failure here is quiet. Drop the membership check and nothing breaks
 * visibly — the endpoint just starts handing out write capabilities. Drop the
 * `enabled` test in db.ts and the vault renders `undefined@undefined` while
 * the feature is dormant. Register the route below the SPA catch-all and it
 * answers index.html with a 200 (see reference_spa_catchall_200), the JSON
 * parse yields nothing, and the row silently never appears.
 *
 * The pipeline's own logic is covered by server/inboundMail.test.mjs. This
 * file covers the seams that file cannot see: route ordering, the client's
 * reading of the response, and whether anything renders the result at all.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const server = read('server.js');
const db = read('src/utils/db.ts');
const vault = read('src/components/DocumentVault.tsx');

let n = 0;
const check = (label: string, cond: boolean) => { assert.ok(cond, `FAILED: ${label}`); n++; };

// ── 1. The address endpoint is member-only ─────────────────────────────────
const ADDRESS_ROUTE = /app\.get\('\/api\/inbound-mail\/address'[\s\S]{0,600}?\n\}\);/;
const routeMatch = server.match(ADDRESS_ROUTE);
check('the address endpoint exists', !!routeMatch);
const route = routeMatch![0];

check('it authenticates the caller before doing anything else',
  /requireMember\(req\)/.test(route));
check('and refuses rather than continuing when that fails',
  /if \(caller\.error\) return res\.status\(caller\.status\)/.test(route));

// The address must be derived from the CALLER's own family, never from
// anything in the request. A familyId query parameter would turn this into an
// oracle for every other family's inbound address.
check('the token is derived from the caller\'s own family id',
  /familyAddressToken\(caller\.familyId/.test(route));
check('nothing in the request body or query feeds the derivation',
  !/req\.(query|body|params)/.test(route));

// ── 2. Dormancy answers a shape, not an error ──────────────────────────────
// The feature is dormant in production today (no MX domain exists). A 404 or a
// 503 here would make the client's happy path an error path; `enabled:false`
// keeps one shape to read either way.
check('a dormant deployment answers enabled:false, not an error status',
  /if \(!INBOUND_MAIL_READY\) return res\.json\(\{ enabled: false \}\)/.test(route));
check('and the live answer carries both the flag and the address',
  /enabled: true, address:/.test(route));

// ── 3. Route ordering: above the SPA catch-all ─────────────────────────────
// An unknown /api path falls through to app.get('*') and returns index.html
// with a 200 — not a 404. res.json() on that response never runs, res.ok is
// true, and the client reads an HTML body as JSON: no error, no address, no
// clue why.
const addressAt = server.indexOf("app.get('/api/inbound-mail/address'");
const catchAllAt = server.indexOf("app.get('*'");
check('the address route is registered above the SPA catch-all',
  addressAt > -1 && catchAllAt > -1 && addressAt < catchAllAt);

// ── 4. The client reads the response conservatively ────────────────────────
const FETCH_FN = /export async function fetchInboundMailAddress[\s\S]{0,900}?\n\}/;
const fnMatch = db.match(FETCH_FN);
check('db.ts exposes fetchInboundMailAddress', !!fnMatch);
const fn = fnMatch![0];

check('it sends the caller\'s ID token, since the endpoint is member-only',
  /Authorization: `Bearer \$\{token\}`/.test(fn));
check('a non-ok response yields null rather than throwing',
  /if \(!res\.ok\) return null/.test(fn));
check('the enabled flag AND the address type are both required',
  /data\?\.enabled && typeof data\.address === 'string'/.test(fn));
check('a thrown fetch yields null too — a missing row beats a crashed vault',
  /catch \{\s*return null;\s*\}/.test(fn));
check('it returns a nullable string, so callers must handle absence',
  /fetchInboundMailAddress\(\): Promise<string \| null>/.test(db));

// ── 5. Something actually renders it ───────────────────────────────────────
// The pipeline is unusable without this. The address cannot be guessed, typed
// from memory, or found anywhere else — if no screen shows it, every server
// test above passes and the feature does not exist.
check('the vault fetches the address', /fetchInboundMailAddress\(\)/.test(vault));
check('and renders it only when there is one',
  /\{inboundAddress && \(/.test(vault));
check('the address itself appears on screen', /\{inboundAddress\}/.test(vault));
check('with a copy control, because nobody retypes an HMAC',
  /writeText\(inboundAddress\)/.test(vault));

// A tick that appears before the clipboard write resolves is a lie on the one
// path that matters: permission denied. The person walks away believing they
// hold an address they do not have.
check('the copied tick is set inside the clipboard promise, not beside it',
  /writeText\(inboundAddress\)[\s\S]{0,200}?\.then\(\(\) => \{[\s\S]{0,120}?setCopiedAddress\(true\)/.test(vault));
check('and a rejected clipboard write is swallowed without a false tick',
  /\.catch\(\(\) => \{[^}]*\}\);/.test(vault));

// ── THE CONTROLS ───────────────────────────────────────────────────────────
//
// Every check above is a regex against a file. A typo in the pattern, or a
// harmless rename, makes one assert nothing while still passing. These prove
// each shape can fail.
{
  const noAuth = "app.get('/api/inbound-mail/address', async (req, res) => {\n  return res.json({ enabled: true, address: 'x@y' });\n});";
  check('CONTROL: an endpoint with no membership check WOULD be caught',
    !/requireMember\(req\)/.test(noAuth));

  const fromQuery = "  const token = familyAddressToken(req.query.familyId, SECRET);";
  check('CONTROL: deriving the address from the request WOULD be caught',
    /req\.(query|body|params)/.test(fromQuery));

  const throwsOn503 = "  const res = await fetch(url);\n  if (!res.ok) throw new Error('no');";
  check('CONTROL: a version that throws instead of returning null WOULD be caught',
    !/if \(!res\.ok\) return null/.test(throwsOn503));

  const flagOnly = "    return data?.enabled ? data.address : null;";
  check('CONTROL: reading enabled without type-checking the address WOULD be caught',
    !/data\?\.enabled && typeof data\.address === 'string'/.test(flagOnly));

  const eagerTick = "onClick={() => { navigator.clipboard?.writeText(inboundAddress); setCopiedAddress(true); }}";
  check('CONTROL: a tick set outside the promise WOULD be caught',
    !/writeText\(inboundAddress\)[\s\S]{0,200}?\.then\(\(\) => \{[\s\S]{0,120}?setCopiedAddress\(true\)/.test(eagerTick));
  check('CONTROL: and the same pattern passes on a correctly nested one, so it is not unmatchable',
    /writeText\(inboundAddress\)[\s\S]{0,200}?\.then\(\(\) => \{[\s\S]{0,120}?setCopiedAddress\(true\)/
      .test("navigator.clipboard?.writeText(inboundAddress).then(() => {\n  setCopiedAddress(true);\n})"));

  const belowCatchAll = "app.get('*', h);\napp.get('/api/inbound-mail/address', h);";
  check('CONTROL: the ordering check DOES fail when the route sits below the catch-all',
    !(belowCatchAll.indexOf("app.get('/api/inbound-mail/address'") < belowCatchAll.indexOf("app.get('*'")));

  const unrendered = "const [inboundAddress, setInboundAddress] = useState<string | null>(null);";
  check('CONTROL: state that is fetched but never rendered WOULD be caught',
    !/\{inboundAddress && \(/.test(unrendered));
}

console.log(`inboundMailWiring.test.ts: ${n} assertions passed.`);
