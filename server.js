import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0384516171';
const FIREBASE_AUTH_HOST = `${PROJECT_ID}.firebaseapp.com`;
// The app's Firestore is a NAMED database — admin.firestore() would silently
// target the nonexistent (default) DB (which is why server-side joins failed).
const DB_ID = process.env.FIRESTORE_DB_ID || 'ai-studio-393d7146-0d1a-431e-bd58-b2a1478b5ff5';

admin.initializeApp({ projectId: PROJECT_ID });
const adminDb = getFirestore(admin.app(), DB_ID);

// ---------------------------------------------------------------------------
// Membership auth: verify the Firebase ID token, require a verified email,
// and resolve the caller's family from users/{uid} (written ONLY by the
// server-side create/join flows below). Replaces the old 3-email allowlist so
// AI features work for every real family. Also lazily backfills the familyId
// custom claim that Storage rules use.
// ---------------------------------------------------------------------------
async function requireMember(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return { status: 401, error: 'Please sign in first.' };
  let decoded;
  try { decoded = await admin.auth().verifyIdToken(token); }
  catch { return { status: 401, error: 'Your session expired — sign in again.' }; }
  if (!decoded.email_verified) return { status: 403, error: 'Please verify your Google account email first.' };
  const snap = await adminDb.doc(`users/${decoded.uid}`).get();
  if (!snap.exists) return { status: 403, error: 'This account is not part of a family yet — create or join one first.' };
  const profile = snap.data();
  if (decoded.familyId !== profile.familyId) {
    // Storage rules read this claim; backfill for accounts from before claims existed
    admin.auth().setCustomUserClaims(decoded.uid, { familyId: profile.familyId }).catch(() => {});
  }
  return {
    uid: decoded.uid,
    email: (decoded.email || '').toLowerCase(),
    displayName: decoded.name || (decoded.email || ''),
    familyId: profile.familyId,
    role: profile.role,
  };
}

// --- Same-origin Firebase Auth helper proxy (keeps iOS Safari sign-in working) ---
// Mounted at root with a pathFilter so the FULL /__/auth/... path is forwarded
// (mounting on the path would strip the prefix and 404 on Firebase Hosting).
const authProxy = createProxyMiddleware({
  target: `https://${FIREBASE_AUTH_HOST}`,
  changeOrigin: true,
  pathFilter: ['/__/auth/**', '/__/firebase/**'],
});
app.use(authProxy);

app.use(express.json({ limit: '25mb' }));

const SYSTEM_INSTRUCTION = `You are the assistant inside a private family records app ("Family Vault").
You do two things:
1) ANSWER questions by recalling from the provided FAMILY DATA (read-only).
2) EXTRACT facts the user states into structured edits to store in the right place.

Output ONLY valid JSON of the form:
{"reply": string, "edits": Edit[]}

Edit is one of:
- {"kind":"new_member","name":<string>,"role":"Parent"|"Child"|"Grandparent"|"Other","nickname":<string or "">,"birthdate":<YYYY-MM-DD or "">}  // create a brand-new family member
- {"kind":"member","member":<existing member name>,"field":<canonical key>,"value":<string>}
- {"kind":"passport","member":<name>,"country":<country>,"number":<string>,"expiry":<YYYY-MM-DD or "">}
- {"kind":"contact","name":<string>,"relation":<string>,"phone":<string>,"email":<string>}   // a shared family contact (school office, doctor, a friend, etc.)
- {"kind":"number","label":<string>,"value":<string>}                                          // a shared standalone reference number
- {"kind":"document","name":<string>,"category":"Identity"|"Education"|"Medical"|"Financial"|"Travel"|"Other","member":<existing member name or "">}  // file the ATTACHED scan into the Document Vault; set "member" to the family member the document belongs to (their passport/ID/school report/medical letter) so it ALSO files into that person's own Documents tab
- {"kind":"calendar_event","title":<string>,"date":<YYYY-MM-DD>,"time":<HH:MM or "">,"category":"Milestone"|"Appointment"|"School"|"Travel"|"Other","memberNames":[<existing member names>]}  // put an appointment/event on the family calendar
- {"kind":"list_add","list":"vehicles"|"pets"|"utilities"|"banks"|"insurance"|"benefits"|"timeline"|"shopping","item":{<string fields>}}  // add a row to a household/finances/timeline list, or add item(s) to the family shopping list
- {"kind":"asset","name":<string>,"category":"Electronics"|"Bike"|"Sporting"|"Vehicle"|"Jewellery"|"Furniture"|"Other","assignedMember":<existing member name or "">,"make":<string>,"model":<string>,"serialNumber":<string>,"purchaseDate":<YYYY-MM-DD or "">,"purchasePrice":<string>,"notes":<string>}  // add an item to the family asset inventory
- {"kind":"household_set","field":"address"|"doorCode"|"wifiName"|"wifiPassword"|"garageCode","value":<string>}  // set a household property field directly

Canonical member field keys (use ONLY these):
basic: name, nickname, birthdate, place_of_birth, nationality, languages, gender
contact: address, phone, email
sizes: shirt_size, pants_size, shoe_size, dress_size, jacket_size, hat_size, ring_size, height_cm, weight_kg, size_notes
medical: blood_group, allergies, medications, conditions, surgeries, emergency_medication, organ_donor, family_medical_history, medical_notes
identity: sv_number, ecard_number, tax_number, student_number, school_reg_number, residence_permit_number, residence_permit_expiry, national_id_number, citizenship_cert_number, drivers_license_number, drivers_license_expiry
education: school_name, class_grade, teacher_name, teacher_contact
travel: frequent_flyer, travel_insurance_number, etias_status, travel_preferences, emergency_travel_contact
emergency: emergency_contact_name, emergency_contact_phone
preferences: favorite_meals, disliked_foods, dietary_restrictions, favorite_movies, favorite_books, favorite_games, favorite_music, sports, hobbies, clothing_brands, color_preferences

YOU ARE A CAPABLE FAMILY ASSISTANT — not just a form-filler. Using FAMILY DATA you can:
- Answer questions thoroughly (sizes, IDs, medical, school, contacts, documents, calendar, finances, household).
- Reason and compute: ages from birthdates vs today's date; how long until a passport/permit/visa expires and whether to act; suggest clothing/shoe sizes to buy for a child given their current sizes, age and the season; totals and comparisons.
- Summarise and list across the whole family ("everyone's blood type", "what expires this year", "who has allergies", "what documents do we have for Mia").
- Be proactive: when you answer, mention closely-related useful info or a sensible next step, briefly.
- Help plan (gift ideas from a child's likes/wishlist, packing for travel from passports/visas, back-to-school from school info) — as suggestions, not stored unless asked.
When you don't know something from the data, say so and offer to add it. Be warm, natural and genuinely helpful; be concise for simple asks, fuller when the question needs it.

RULES:
- If the user is ASKING/recalling/planning: answer helpfully from FAMILY DATA; edits = [].
- If the user is TELLING you info to store: produce edits and a short reply confirming what you'll set.
- "member" MUST match an existing family member name (case-insensitive). If you cannot tell which member, ASK in reply and return edits=[].
- If the user introduces a NEW person who is NOT already in the family, FIRST add a {"kind":"new_member"} edit, then you may add {"kind":"member"} edits referencing that same new name to fill in their details.
- Dates: YYYY-MM-DD. organ_donor value: "yes" or "no".
- Use kind "passport" for passports, "contact" for people/places to phone (school, doctor, friend), "number" for a loose reference number not tied to a person.
- Use "calendar_event" for appointments, dates, events, and reminders. Resolve relative dates ("next Tuesday", "this Friday") using today's date already given in the prompt. Set memberNames only for names that exist in the family data.
- BIRTHDAYS: when asked to "add birthdays to the calendar" or similar, look up each member's birthdate from FAMILY DATA, compute the next upcoming birthday (if this year's date has already passed use next year, otherwise use this year), and emit one calendar_event per member: {"kind":"calendar_event","title":"<Name>'s Birthday 🎂","date":"<YYYY-MM-DD>","category":"Milestone","memberNames":["<Name>"]}. Do this for ALL members who have a birthdate.
- Use "list_add" to append a row to a list: household lists → vehicles (fields: name, registration, vin, insuranceNumber, serviceDate, notes), pets (name, species, vet, vaccinations, microchip, notes), utilities (type, provider, accountNumber, notes — for electricity/gas/internet/phone ONLY, NOT addresses); finances lists → banks (bankName, accountHolder, iban, bic, notes), insurance (provider, type, policyNumber, renewalDate, notes), benefits (name, reference, notes); family timeline → list="timeline" (date, title, type, note); shopping list → list="shopping" (name). For shopping: each item gets its own {"kind":"list_add","list":"shopping","item":{"name":"<item name>"}} — one edit per item. All dates YYYY-MM-DD.
- ADDRESSES — pick the right target, NEVER use kind "number" or utilities for an address:
  • A SPECIFIC PERSON's address (where a family member lives — e.g. "Shyam's address is...", "my address is...", or a Meldezettel/registration naming one person): store on THAT member with {"kind":"member","member":"<name>","field":"address","value":"<full street, city, postcode>"}. Family members can live at different addresses. Also field "phone" and "email" for a member's own contact details.
  • The SHARED FAMILY HOME / property address (the household property itself, "our home address", "the family address"): store as {"kind":"household_set","field":"address","value":"<full address>"}.
  • If a Meldezettel/registration names a person, set that member's address; only use household_set when it is clearly the main family home with no specific person.
- Wi-Fi credentials: {"kind":"household_set","field":"wifiName","value":"..."} and/or {"kind":"household_set","field":"wifiPassword","value":"..."}. Door/garage codes: field "doorCode" or "garageCode".
- Use "asset" to add items to the family inventory: bikes, scooters, electronics, vehicles, sporting equipment, jewellery, furniture. Include every detail you know (make, model, serial number, price).
- IF AN IMAGE/DOCUMENT IS ATTACHED: read it (OCR). Extract every useful field — match the right kind: address/wifi → household_set; person's ID/passport → member+passport; contacts → contact; loose reference numbers → number. If it's a Meldezettel or registration certificate, read the person it names and set THEIR address with {"kind":"member","member":"<name>","field":"address","value":"<address>"} (each family member can live at a different address) AND save a scan with {"kind":"document","name":"Meldezettel <name>","category":"Identity"}. Only use household_set for the address if no specific family member is named. If it's a keepable document (passport, ID, residence card, birth/marriage cert, school report, insurance card, medical letter, tax doc), ALSO add ONE {"kind":"document"} edit with a short descriptive name, the best-fit category, AND "member" set to the family member it belongs to (match the name on the document to the family data; e.g. Sophie's passport → "member":"Sophie") so the scan lands on their profile too. In the reply, briefly say what you read and what you'll save.
- NEVER invent data. If something needed is missing, ask for it in reply. Keep reply warm and brief.`;

app.post('/api/chat', async (req, res) => {
  try {
    if (!GEMINI_KEY) return res.status(500).json({ error: 'AI is not configured on the server.' });

    const caller = await requireMember(req);
    if (caller.error) return res.status(caller.status).json({ error: caller.error });

    const { message, context, history, image, lang } = req.body || {};
    const hasImage = image && image.data && image.mimeType;
    if ((!message || typeof message !== 'string') && !hasImage) {
      return res.status(400).json({ error: 'No message.' });
    }

    const LANG_NAMES = { en:'English',de:'German',es:'Spanish',fr:'French',pt:'Portuguese',it:'Italian',nl:'Dutch',pl:'Polish',af:'Afrikaans' };
    const langName = LANG_NAMES[lang] || 'English';
    const ctxJson = JSON.stringify(context ?? {}).slice(0, 120000);
    const today = new Date().toISOString().slice(0, 10);
    const userText = (message && typeof message === 'string') ? message
      : 'Please read the attached document and extract any useful family info.';
    const userParts = [{ text: `Today's date is ${today}.\nRESPOND IN: ${langName}. Write your "reply" field in ${langName}. All edit field values stay in the original language (names, labels, dates — never translate these).\nFAMILY DATA (JSON):\n${ctxJson}\n\nUSER MESSAGE:\n${userText}` }];
    if (hasImage) {
      userParts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    }
    const contents = [
      ...((Array.isArray(history) ? history : []).slice(-8).map(h => ({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: String(h.text || '').slice(0, 4000) }],
      }))),
      { role: 'user', parts: userParts },
    ];

    const callGemini = () => fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents,
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
        }),
      }
    );

    // Gemini occasionally returns a transient 503/429 under load — retry a couple times.
    console.log(`[chat] ${hasImage ? 'image+' : ''}text request from ${email}`);
    let gData;
    let text;
    for (let attempt = 0; attempt < 3; attempt++) {
      const gRes = await callGemini();
      gData = await gRes.json();
      // Search all parts — 2.5 Flash thinking model may put output in any part
      const parts = gData?.candidates?.[0]?.content?.parts || [];
      text = parts.find((p) => p.text)?.text;
      if (text) break;
      const code = gData?.error?.code;
      console.warn(`[chat] attempt ${attempt + 1} no text — status ${gRes.status} code ${code}`);
      if (code !== 503 && code !== 429 && gRes.ok) break; // non-retryable
      await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
    }
    if (!text) {
      const errDetail = JSON.stringify(gData).slice(0, 800);
      console.error('Gemini empty response:', errDetail);
      const errCode = gData?.error?.code;
      const errMsg = gData?.error?.message || '';
      if (errCode === 429) return res.status(502).json({ error: 'Gemini quota limit reached — the assistant is temporarily unavailable. Check the API key billing.' });
      if (errCode === 503) return res.status(502).json({ error: 'The assistant is busy right now — please try again in a moment.' });
      const finishReason = gData?.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== 'STOP') return res.status(502).json({ error: `The assistant stopped unexpectedly (${finishReason}). Please try again.` });
      return res.status(502).json({ error: errMsg || 'The assistant did not respond. Please try again.' });
    }

    let parsed;
    try { parsed = JSON.parse(text); }
    catch { parsed = { reply: text, edits: [] }; }
    if (!parsed || typeof parsed.reply !== 'string') parsed = { reply: String(text), edits: [] };
    if (!Array.isArray(parsed.edits)) parsed.edits = [];

    res.json(parsed);
  } catch (e) {
    console.error('chat error', e);
    res.status(500).json({ error: 'Something went wrong talking to the assistant.' });
  }
});

app.post('/api/scan-asset', async (req, res) => {
  try {
    if (!GEMINI_KEY) return res.status(500).json({ error: 'AI is not configured on the server.' });

    const caller = await requireMember(req);
    if (caller.error) return res.status(caller.status).json({ error: caller.error });

    console.log('[scan-asset] request from', caller.email);

    const { image } = req.body || {};
    if (!image || !image.data || !image.mimeType) {
      return res.status(400).json({ error: 'No image provided.' });
    }

    const SCAN_SYSTEM = `You are an OCR assistant. The user will send a photo of a physical item — its label, sticker, barcode, packaging, or the item itself.
Extract ALL identifying information visible. Return ONLY valid JSON (no markdown):
{ "name": string, "make": string, "model": string, "serialNumber": string, "category": "Electronics"|"Bike"|"Sporting"|"Vehicle"|"Jewellery"|"Furniture"|"Other", "size": string, "color": string, "notes": string }
Use empty string "" for any field not visible. category must be one of the enum values — guess from context.`;

    const gRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SCAN_SYSTEM }] },
          contents: [{
            role: 'user',
            parts: [
              { text: 'Please scan this item and extract all visible identifying information.' },
              { inlineData: { mimeType: image.mimeType, data: image.data } },
            ],
          }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
        }),
      }
    );

    const gData = await gRes.json();
    const parts = gData?.candidates?.[0]?.content?.parts || [];
    const text = parts.find((p) => p.text)?.text;

    if (!text) {
      console.error('[scan-asset] empty response:', JSON.stringify(gData).slice(0, 400));
      return res.status(502).json({ error: 'Could not read the image — please try again or enter details manually.' });
    }

    let parsed;
    try { parsed = JSON.parse(text); }
    catch { return res.status(502).json({ error: 'Could not parse the scan result — please try again.' }); }

    res.json(parsed);
  } catch (e) {
    console.error('[scan-asset] error', e);
    res.status(502).json({ error: 'Something went wrong scanning the item — please try again.' });
  }
});

// ---------------------------------------------------------------------------
// Family membership endpoints. All writes to users/{uid} and roles/{uid}
// happen HERE with the Admin SDK — Firestore rules block them from clients,
// so nobody can pick their own role or walk into a family uninvited.
// ---------------------------------------------------------------------------

// Verify token only (caller may not be in a family yet)
async function requireSignedIn(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return { status: 401, error: 'Please sign in first.' };
  let decoded;
  try { decoded = await admin.auth().verifyIdToken(token); }
  catch { return { status: 401, error: 'Your session expired — sign in again.' }; }
  if (!decoded.email_verified) return { status: 403, error: 'Please verify your Google account email first.' };
  return {
    uid: decoded.uid,
    email: (decoded.email || '').toLowerCase(),
    displayName: decoded.name || (decoded.email || ''),
  };
}

async function grantMembership(uid, email, displayName, familyId, role) {
  const batch = adminDb.batch();
  batch.set(adminDb.doc(`families/${familyId}/roles/${uid}`), { role, email, displayName });
  batch.set(adminDb.doc(`users/${uid}`), { familyId, role, email, displayName });
  await batch.commit();
  // Storage rules gate vault files on this claim
  await admin.auth().setCustomUserClaims(uid, { familyId }).catch(() => {});
}

// --- Create a new family (caller becomes its admin) ---
app.post('/api/create-family', async (req, res) => {
  try {
    const caller = await requireSignedIn(req);
    if (caller.error) return res.status(caller.status).json({ error: caller.error });

    const name = String((req.body || {}).name || '').trim() || 'Our Family';
    const familyId = crypto.randomUUID();
    await adminDb.doc(`families/${familyId}/info/info`).set({
      name, createdAt: new Date().toISOString().slice(0, 10), adminUid: caller.uid,
    });
    await grantMembership(caller.uid, caller.email, caller.displayName, familyId, 'admin');
    res.json({ ok: true, familyId });
  } catch (err) {
    console.error('/api/create-family error:', err);
    res.status(500).json({ error: 'Could not create the family. Please try again.' });
  }
});

// --- Create an invite code (admins only) ---
app.post('/api/create-invite', async (req, res) => {
  try {
    const caller = await requireMember(req);
    if (caller.error) return res.status(caller.status).json({ error: caller.error });
    if (caller.role !== 'admin') return res.status(403).json({ error: 'Only admins can create invites.' });

    // Short, readable, unguessable enough for a 14-day single-use code
    const code = crypto.randomBytes(6).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
      || crypto.randomBytes(4).toString('hex').toUpperCase();
    const role = (req.body || {}).role === 'child' ? 'child' : 'member';
    await adminDb.doc(`invites/${code}`).set({
      familyId: caller.familyId,
      role,
      createdBy: caller.uid,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
      usedBy: null,
    });
    res.json({ ok: true, code, role });
  } catch (err) {
    console.error('/api/create-invite error:', err);
    res.status(500).json({ error: 'Could not create an invite. Please try again.' });
  }
});

// --- Join a family with an invite code ---
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
app.post('/api/join-family', async (req, res) => {
  try {
    const caller = await requireSignedIn(req);
    if (caller.error) return res.status(caller.status).json({ error: caller.error });

    const raw = String((req.body || {}).code ?? (req.body || {}).familyId ?? '').trim();
    if (!raw) return res.status(400).json({ error: 'Missing invite code.' });

    // Preferred path: an admin-issued invite code
    const inviteRef = adminDb.doc(`invites/${raw.toUpperCase()}`);
    const inviteSnap = await inviteRef.get();
    if (inviteSnap.exists) {
      const inv = inviteSnap.data();
      if (inv.usedBy) return res.status(410).json({ error: 'This invite was already used — ask your admin for a new one.' });
      if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) {
        return res.status(410).json({ error: 'This invite has expired — ask your admin for a new one.' });
      }
      await grantMembership(caller.uid, caller.email, caller.displayName, inv.familyId, inv.role || 'member');
      await inviteRef.set({ usedBy: caller.uid, usedAt: new Date().toISOString() }, { merge: true });
      return res.json({ ok: true, familyId: inv.familyId });
    }

    // Legacy path: a raw family UUID (unguessable). Short ids like 'household'
    // are deliberately NOT joinable this way.
    if (UUID_RE.test(raw)) {
      const rolesSnap = await adminDb.collection(`families/${raw}/roles`).limit(1).get();
      if (!rolesSnap.empty) {
        await grantMembership(caller.uid, caller.email, caller.displayName, raw, 'member');
        return res.json({ ok: true, familyId: raw });
      }
    }

    return res.status(404).json({ error: 'Invite code not found — ask your family admin to share a fresh one.' });
  } catch (err) {
    console.error('/api/join-family error:', err);
    res.status(500).json({ error: 'Could not join family. Please try again.' });
  }
});

// --- Refresh custom claims (called by the client when its token lacks familyId) ---
app.post('/api/refresh-claims', async (req, res) => {
  try {
    const caller = await requireMember(req); // requireMember backfills the claim
    if (caller.error) return res.status(caller.status).json({ error: caller.error });
    res.json({ ok: true, familyId: caller.familyId });
  } catch (err) {
    console.error('/api/refresh-claims error:', err);
    res.status(500).json({ error: 'Could not refresh session.' });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// --- Static SPA ---
// Build stamp for the in-app "update available" check. Never cached, so a tab
// that has been open across a deploy always sees the freshly deployed build id.
app.get('/version.json', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'dist', 'version.json'), (err) => {
    if (err && !res.headersSent) res.status(404).json({ version: null });
  });
});
app.use(express.static(path.join(__dirname, 'dist')));
// The HTML entry must revalidate every load so a refresh always picks up the
// newest hashed asset bundle (the assets themselves are content-hashed and
// safely long-cached by express.static).
app.get('*', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => console.log(`Family Vault server listening on ${PORT}`));
