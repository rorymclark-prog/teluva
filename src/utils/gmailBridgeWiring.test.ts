/* Standalone assertions — npx tsx src/utils/gmailBridgeWiring.test.ts
 *
 * WHAT IS BEING GUARDED.
 *
 * Teluva cannot read Gmail. Every scope that can — gmail.readonly,
 * gmail.metadata, gmail.modify — is a Google RESTRICTED scope, and a published
 * app asking for one must pass an annual third-party CASA assessment. So the
 * reading happens in a Google Apps Script running in the person's OWN account
 * (apps-script/teluva-gmail-bridge), which is subject to none of that, and the
 * script pushes attachments into the vault with a bridge token.
 *
 * A BRIDGE TOKEN IS A WRITE CAPABILITY. Anyone holding one can put documents
 * into that family's vault. It is closer to a house key than to a password,
 * and every assertion below follows from that: minted by an admin only,
 * returned exactly once, persisted only as a hash, revocable, rate limited,
 * and re-verified on every delivery against the family's own record rather
 * than against the lookup index that found it.
 *
 * The module's own logic — hashing, timing-safe compare, de-duplication,
 * attachment filtering — is covered by server/gmailBridge.test.mjs. This file
 * covers what that file cannot see: whether the routes are wired the way the
 * design requires, whether the client reads them correctly, whether anything
 * renders the token, and whether the privacy promise the UI makes out loud is
 * actually true of the script that runs.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const server = read('server.js');
const db = read('src/utils/db.ts');
const vault = read('src/components/DocumentVault.tsx');
const script = read('apps-script/teluva-gmail-bridge/Code.gs');

/* Comments are stripped before any behavioural check runs over the script.
 * This is not tidiness — the first version of this file failed because
 * Code.gs's own header says "getPlainBody() and getBody() are never called
 * anywhere in this file", and the guard matched the sentence promising the
 * opposite of what it was looking for. A prose mention must never be able to
 * satisfy or defeat a source check (see reference_source_text_guards). */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const scriptCode = stripComments(script);

let n = 0;
const check = (label: string, cond: boolean) => { assert.ok(cond, `FAILED: ${label}`); n++; };

const routeBody = (pattern: RegExp) => {
  const m = server.match(pattern);
  assert.ok(m, `FAILED: could not find route matching ${pattern}`);
  return m![0];
};

// ── 1. Minting and revoking are ADMIN work, not member work ────────────────
// Same bar as creating an invite (`/api/create-invite`), and for the same
// reason: both hand out a way into the vault to someone who is not signed in.
const mint = routeBody(/app\.post\('\/api\/gmail-bridge\/token'[\s\S]{0,2000}?\n\}\);/);
const revoke = routeBody(/app\.delete\('\/api\/gmail-bridge\/token'[\s\S]{0,1200}?\n\}\);/);
const status = routeBody(/app\.get\('\/api\/gmail-bridge\/status'[\s\S]{0,1200}?\n\}\);/);
const deliver = routeBody(/app\.post\('\/api\/gmail-bridge\/deliver'[\s\S]{0,4000}?\n\}\);/);

check('minting authenticates the caller', /requireMember\(req\)/.test(mint));
check('and requires admin, not merely membership', /caller\.role !== 'admin'/.test(mint));
check('revoking requires admin too', /caller\.role !== 'admin'/.test(revoke));
check('status is member-only', /requireMember\(req\)/.test(status));

// ── 2. The raw token exists in exactly one response ────────────────────────
// If status ever returned it, the "shown once" promise in the UI would be a
// lie and the token would sit readable in every page load.
check('the mint route returns the raw token', /res\.json\(\{ token,/.test(mint));
check('status does NOT return the raw token', !/\btoken\b\s*[,:]/.test(status.replace(/tokenHash/g, '')));
check('status does not leak the hash either', !/tokenHash:/.test(status));
check('only the hash is persisted', /hashBridgeToken\(token\)/.test(mint) && !/set\(\{[^}]*\btoken\b[^H]/.test(mint));

// ── 3. Rotating must not leave two live tokens ─────────────────────────────
// The old index entry is deleted BEFORE the new one is written. Doing it the
// other way round means a crash in between leaves two working tokens, and the
// one the person believes they revoked is the one still filing documents.
const oldDeleteAt = mint.indexOf('prevHash');
const newWriteAt = mint.indexOf('BRIDGE_INDEX(tokenHash)).set');
check('rotating deletes the previous index entry before writing the new one',
  oldDeleteAt > -1 && newWriteAt > -1 && oldDeleteAt < newWriteAt);
check('revoking removes the index entry as well as the family record',
  /BRIDGE_INDEX\(hash\)\)\.delete/.test(revoke) && /ref\.delete\(\)/.test(revoke));

// ── 4. Delivery: the index finds it, the family record authorises it ───────
// A stale or forged index entry must not be sufficient on its own. The
// timing-safe re-verification against the family's own stored hash is the
// actual authorisation decision.
check('delivery re-verifies the presented token against the family record',
  /verifyBridgeToken\(presented, stored\.tokenHash\)/.test(deliver));
check('a missing family record denies rather than falling through',
  /!stored \|\| !verifyBridgeToken/.test(deliver));
check('an absent bearer token is refused before any lookup',
  /if \(!presented\) return res\.status\(401\)/.test(deliver));

// This route is reachable without a signed-in session — it is the only one of
// the four that is. That is exactly why it needs its own IP limit.
check('delivery is IP rate limited', /ipRateLimited\('gmail-bridge-deliver'/.test(deliver));
check('and limited per family as well, so one token cannot flood a vault',
  /keyedRateLimited\(`gmail-bridge\|\$\{familyId\}`/.test(deliver));

// The Apps Script proves its token with an empty delivery before it touches
// the mailbox. If that answered an error, the first thing a new user does
// would look like a failure.
check('an empty delivery answers 200 so the connection test can succeed',
  /attachments\.length === 0\) return res\.json\(\{ ok: true, filed: 0/.test(deliver));

// ── 5. Route ordering, above the SPA catch-all ─────────────────────────────
// An unknown /api path returns index.html with a 200, not a 404 — so a route
// registered below the catch-all does not error, it silently answers HTML.
const catchAllAt = server.indexOf("app.get('*'");
for (const route of ['/api/gmail-bridge/status', '/api/gmail-bridge/token', '/api/gmail-bridge/deliver']) {
  check(`${route} is registered above the SPA catch-all`,
    server.indexOf(route) > -1 && server.indexOf(route) < catchAllAt);
}

// ── 6. ONE implementation of vault filing ──────────────────────────────────
// Two pipelines write documents now. A second copy of the storage layout, the
// download-token metadata and the transaction would drift, and a near-copy
// that forgets the token produces documents that look filed and will not open.
check('a shared helper does the filing', /async function fileAttachmentsIntoVault\(/.test(server));
const helperCalls = server.match(/await fileAttachmentsIntoVault\(/g) || [];
check('and BOTH pipelines call it', helperCalls.length === 2);
check('the inbound-mail route no longer carries its own copy of the loop',
  (server.match(/firebaseStorageDownloadTokens/g) || []).length === 1);

// ── 7. The client ──────────────────────────────────────────────────────────
check('db.ts can mint', /export async function createGmailBridgeToken\(\): Promise<string>/.test(db));
check('db.ts can revoke', /export async function revokeGmailBridgeToken\(\)/.test(db));
check('status returns null rather than throwing when unavailable',
  /export async function fetchGmailBridgeStatus[\s\S]{0,800}?catch \{\s*return null;\s*\}/.test(db));
check('revoke uses DELETE, matching the route', /method: 'DELETE'/.test(db));

check('the vault renders the panel', /gmailStatus && \(/.test(vault));
check('it shows the token when there is one to show', /\{gmailToken\}/.test(vault));
check('and says out loud that it is shown once',
  /shown once/i.test(vault));
check('the copied tick waits for the clipboard promise',
  /writeText\(gmailToken\)[\s\S]{0,200}?\.then\(\(\) => \{[\s\S]{0,120}?setCopiedToken\(true\)/.test(vault));
check('a disconnect control exists', /revokeGmailBridgeToken\(\)/.test(vault));

// ── 8. The privacy promise the UI makes must be TRUE ───────────────────────
// The panel tells people "It never reads the text of your messages." That is
// a claim about a file in a different repository directory that nothing else
// checks. GmailMessage.getBody()/getPlainBody() are the only ways an Apps
// Script reads a message body; their absence is the promise.
check('the vault makes the never-reads-your-messages claim',
  /never reads the text of your messages/.test(vault));
check('and the script genuinely never reads a message body',
  !/getPlainBody\(|\.getBody\(/.test(scriptCode));
check('the script only sends the subject, the sender and the attachments',
  /gmailMessageId:[\s\S]{0,200}?subject:[\s\S]{0,120}?from:[\s\S]{0,120}?attachments:/.test(scriptCode));

// A content type is compared against the literal prefix "image/". Checking
// "image" without the slash also admits "image-not-really/x".
check('the script matches the image family by the prefix WITH the slash',
  /'image\/'/.test(scriptCode) && !/startsWith\('image'\)/.test(scriptCode));

// A 401/403 will not fix itself. Retrying a dead token every fifteen minutes
// forever is how a background job gets itself rate limited.
check('the script stops rather than looping on a rejected token',
  /status === 401 \|\| result\.status === 403/.test(scriptCode));

// ── THE CONTROLS ───────────────────────────────────────────────────────────
//
// Every check above is a regex over a file. A typo in the pattern, or an
// innocent rename, makes one assert nothing while still passing. These prove
// the shapes can fail.
{
  const memberOnly = "app.post('/api/gmail-bridge/token', async (req, res) => {\n  const caller = await requireMember(req);\n  return res.json({ token: mintBridgeToken() });\n});";
  check('CONTROL: a mint route with no admin check WOULD be caught',
    !/caller\.role !== 'admin'/.test(memberOnly));

  const indexOnly = "  const familyId = indexSnap.data()?.familyId;\n  // trusts the index alone\n";
  check('CONTROL: trusting the index without re-verifying WOULD be caught',
    !/verifyBridgeToken\(presented, stored\.tokenHash\)/.test(indexOnly));

  const wrongOrder = "await set(BRIDGE_INDEX(tokenHash)).set(x); const prevHash = y;";
  check('CONTROL: the rotate-ordering check DOES fail when the writes are swapped',
    !(wrongOrder.indexOf('prevHash') < wrongOrder.indexOf('BRIDGE_INDEX(tokenHash)).set')));

  check('CONTROL: a script that read message bodies WOULD be caught',
    /getPlainBody\(|\.getBody\(/.test('var text = message.getPlainBody();'));
  check('CONTROL: and the same pattern clears a script that does not, so it is not unmatchable',
    !/getPlainBody\(|\.getBody\(/.test('var subject = message.getSubject();'));

  // The stripper is now load-bearing: if it silently removed nothing, the
  // body-reading check would pass on a script whose comments merely mention
  // the method. And if it removed too much, the check would pass on a script
  // that really does call it.
  check('CONTROL: stripComments removes a comment that MENTIONS getPlainBody()',
    !/getPlainBody\(/.test(stripComments('/* getPlainBody() is never called */\nvar a = 1;')));
  check('CONTROL: but leaves a real call to it standing',
    /getPlainBody\(/.test(stripComments('// harmless\nvar t = message.getPlainBody();')));
  check('CONTROL: and the real script still has content after stripping',
    scriptCode.includes('function syncTeluva') && scriptCode.length > 2000);

  check('CONTROL: a naive image check WOULD be caught',
    /startsWith\('image'\)/.test("if (type.startsWith('image')) keep();"));

  const eagerTick = "onClick={() => { navigator.clipboard?.writeText(gmailToken); setCopiedToken(true); }}";
  check('CONTROL: a tick set outside the clipboard promise WOULD be caught',
    !/writeText\(gmailToken\)[\s\S]{0,200}?\.then\(\(\) => \{[\s\S]{0,120}?setCopiedToken\(true\)/.test(eagerTick));

  const twoCopies = 'firebaseStorageDownloadTokens: a\nfirebaseStorageDownloadTokens: b';
  check('CONTROL: a second copy of the filing loop WOULD be caught',
    (twoCopies.match(/firebaseStorageDownloadTokens/g) || []).length !== 1);
}

console.log(`gmailBridgeWiring.test.ts: ${n} assertions passed.`);
