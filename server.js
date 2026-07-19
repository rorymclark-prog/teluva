import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleAuth } from 'google-auth-library';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0384516171';

// ---------------------------------------------------------------------------
// AI backend. We call Gemini through Vertex AI in an EU region (default) so that
// (a) usage falls under Google Cloud's enterprise terms — the consumer Gemini
// Developer API forbids under-18 use, which a family app cannot honour — and
// (b) inference data stays in the EU. Auth is the Cloud Run runtime service
// account via ADC (no API key). Set USE_VERTEX=0 to fall back to the dev API
// (emergency rollback only — reintroduces the under-18 ToS problem).
// ---------------------------------------------------------------------------
const USE_VERTEX = process.env.USE_VERTEX !== '0';
const VERTEX_PROJECT = process.env.VERTEX_PROJECT || PROJECT_ID;
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'europe-west1';
// The image model differs by backend: Vertex publishes gemini-2.5-flash-image
// ("Nano Banana"); the dev API used gemini-3.1-flash-image.
const MODEL_TEXT = 'gemini-2.5-flash';
const MODEL_IMAGE = USE_VERTEX ? 'gemini-2.5-flash-image' : 'gemini-3.1-flash-image';
const AI_CONSENT_VERSION = 1;
// Dark-launch gate for the recall-only insurance-conditions reader. OFF unless
// FEATURE_INSURANCE_READER is explicitly set. This is the AUTHORITATIVE gate —
// even if a client is built with the feature on, the endpoint refuses until a
// licensed Austrian lawyer clears the recall/advice line (GewO §137). See
// src/config/features.ts for the paired client flag.
const FEATURE_INSURANCE_READER = process.env.FEATURE_INSURANCE_READER === '1';

const gAuth = USE_VERTEX
  ? new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' })
  : null;
let _gClient = null;
async function vertexToken() {
  if (!_gClient) _gClient = await gAuth.getClient();
  const t = await _gClient.getAccessToken();
  return typeof t === 'string' ? t : t?.token;
}

// Unified generateContent call — Vertex EU by default, dev API as fallback.
// Request/response shapes are identical across both backends, so callers are
// unchanged. Returns the raw fetch Response.
async function generateContent(model, body) {
  if (USE_VERTEX) {
    const token = await vertexToken();
    const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${model}:generateContent`;
    return fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
}
const AI_READY = USE_VERTEX || !!GEMINI_KEY;
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
    aiConsent: profile.aiConsent?.granted === true && (profile.aiConsent?.version ?? 0) >= AI_CONSENT_VERSION,
  };
}

// AI gate (defense in depth alongside the UI): child accounts never use AI, and
// every adult must have explicitly opted in (GDPR consent) before anything is
// sent to Google's models. Returns an error string to send, or null to proceed.
function aiGateBlocked(caller) {
  if (caller.role === 'child') return 'AI features are not available on child accounts.';
  if (!caller.aiConsent) return 'Please turn on the AI assistant in Settings first — it is off until you opt in.';
  return null;
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
- {"kind":"transit_pass","member":<existing member name>,"name":<string>,"operator":<string>,"cardNumber":<string>,"zone":<string>,"validFrom":<YYYY-MM-DD or "">,"validUntil":<YYYY-MM-DD or "">,"notes":<string>}  // a season ticket / travel card for one person: Wiener Linien Jahreskarte, ÖBB Klimaticket, a student/rail pass. "name" is the pass name; "validUntil" is its expiry
- {"kind":"care_schedule","member":<existing member name>,"careKind":<string>,"provider":<string>,"lastVisit":<YYYY-MM-DD or "">,"intervalMonths":<number>,"nextDue":<YYYY-MM-DD or "">,"notes":<string>}  // a RECURRING health/admin appointment for one person: dental check-up, yearly medical check-up, eye test, vaccination booster. Set "lastVisit" + "intervalMonths" (e.g. 6 = twice a year, 12 = yearly) so the app can remind when the next one is due; OR set "nextDue" for a known next appointment date

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
- Use "transit_pass" for a person's season ticket / travel card (Jahreskarte, Klimaticket, monthly/annual public-transport or rail pass) — NOT kind "number". Read the card/operator name, card number, zone, and the valid-until (expiry) date. If a pass card is attached, ALSO save a {"kind":"document","category":"Travel","member":"<name>"} scan.
- Use "care_schedule" when the user mentions a RECURRING check-up ("Mia's dentist every 6 months", "annual eye test", "yearly check-up", "her last dental visit was in March"). Capture careKind, lastVisit and intervalMonths (or a specific nextDue). For a ONE-OFF appointment on a specific date, use "calendar_event" instead — care_schedule is for repeating ones.
- IF AN IMAGE/DOCUMENT IS ATTACHED: read it (OCR). Extract every useful field — match the right kind: address/wifi → household_set; person's ID/passport → member+passport; contacts → contact; loose reference numbers → number. If it's a Meldezettel or registration certificate, read the person it names and set THEIR address with {"kind":"member","member":"<name>","field":"address","value":"<address>"} (each family member can live at a different address) AND save a scan with {"kind":"document","name":"Meldezettel <name>","category":"Identity"}. Only use household_set for the address if no specific family member is named. If it's a keepable document (passport, ID, residence card, birth/marriage cert, school report, insurance card, medical letter, tax doc), ALSO add ONE {"kind":"document"} edit with a short descriptive name, the best-fit category, AND "member" set to the family member it belongs to (match the name on the document to the family data; e.g. Sophie's passport → "member":"Sophie") so the scan lands on their profile too. In the reply, briefly say what you read and what you'll save.
- NEVER invent data. If something needed is missing, ask for it in reply. Keep reply warm and brief.
- BOUNDARIES: You organise and recall the family's own records — you are NOT a doctor, lawyer, pharmacist or financial adviser. NEVER give medical, legal, or financial ADVICE, diagnosis, dosing, interpretation of results, or treatment/product recommendations. You may store and read back what the family recorded (e.g. "her allergy is peanuts"), but if asked for advice ("is this rash serious?", "what dose?", "should we invest?"), gently decline and suggest they consult a qualified professional. You can be wrong — never present a guess as fact.
- INSURANCE: Any insurance policy obligations/conditions recorded on a policy may be read back to the user verbatim, but must NEVER be interpreted, assessed for coverage, judged, or turned into advice, warnings, or next steps (e.g. never say whether they are covered, whether a claim would pay, or that they should switch/cancel). Recall only.`;

// In-memory per-user rate limit for the AI endpoints — Gemini calls cost money and
// are the abuse surface. Per Cloud Run instance (a fine first layer); the cap is
// generous enough that normal family use never hits it.
const aiHits = new Map(); // uid -> timestamps (ms)
const AI_WINDOW_MS = 60 * 1000;
const AI_MAX_PER_WINDOW = 20;
function aiRateLimited(uid) {
  const now = Date.now();
  const arr = (aiHits.get(uid) || []).filter((t) => now - t < AI_WINDOW_MS);
  arr.push(now);
  aiHits.set(uid, arr);
  if (aiHits.size > 5000) { // bound memory
    for (const [k, v] of aiHits) if (!v.some((t) => now - t < AI_WINDOW_MS)) aiHits.delete(k);
  }
  return arr.length > AI_MAX_PER_WINDOW;
}

app.post('/api/chat', async (req, res) => {
  try {
    if (!AI_READY) return res.status(500).json({ error: 'AI is not configured on the server.' });

    const caller = await requireMember(req);
    if (caller.error) return res.status(caller.status).json({ error: caller.error });
    if (aiRateLimited(caller.uid)) return res.status(429).json({ error: 'Too many requests — please wait a minute and try again.' });
    const gateErr = aiGateBlocked(caller);
    if (gateErr) return res.status(403).json({ error: gateErr });

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

    const callGemini = () => generateContent(MODEL_TEXT, {
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents,
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    });

    // Gemini occasionally returns a transient 503/429 under load — retry a couple times.
    console.log(`[chat] ${hasImage ? 'image+' : ''}text request from ${caller.email}`);
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
    if (!AI_READY) return res.status(500).json({ error: 'AI is not configured on the server.' });

    const caller = await requireMember(req);
    if (caller.error) return res.status(caller.status).json({ error: caller.error });
    if (aiRateLimited(caller.uid)) return res.status(429).json({ error: 'Too many requests — please wait a minute and try again.' });
    const gateErr = aiGateBlocked(caller);
    if (gateErr) return res.status(403).json({ error: gateErr });

    console.log('[scan-asset] request from', caller.email);

    const { image } = req.body || {};
    if (!image || !image.data || !image.mimeType) {
      return res.status(400).json({ error: 'No image provided.' });
    }

    const SCAN_SYSTEM = `You are an OCR assistant. The user will send a photo of a physical item — its label, sticker, barcode, packaging, or the item itself.
Extract ALL identifying information visible. Return ONLY valid JSON (no markdown):
{ "name": string, "make": string, "model": string, "serialNumber": string, "category": "Electronics"|"Bike"|"Sporting"|"Vehicle"|"Jewellery"|"Furniture"|"Other", "size": string, "color": string, "notes": string }
Use empty string "" for any field not visible. category must be one of the enum values — guess from context.`;

    const gRes = await generateContent(MODEL_TEXT, {
      systemInstruction: { parts: [{ text: SCAN_SYSTEM }] },
      contents: [{
        role: 'user',
        parts: [
          { text: 'Please scan this item and extract all visible identifying information.' },
          { inlineData: { mimeType: image.mimeType, data: image.data } },
        ],
      }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    });

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

// Recall-only insurance-conditions reader (DARK-LAUNCHED — gated on
// FEATURE_INSURANCE_READER). The user submits a photo or the text of THEIR OWN
// policy; we return ONLY verbatim quotes of the obligations/conditions the
// policyholder must satisfy. It is legally a quoting tool ("mere information"),
// NOT insurance advice: it must never state coverage, give recommendations, or
// assess claims. The strict prompt + a whitelist-shaped JSON schema keep advice
// structurally out of the response.
const INSURANCE_READ_SYSTEM = `You are a document QUOTING tool inside a private family app. The user gives you the text or an image of THEIR OWN insurance policy document.
Your ONLY job: copy out, WORD FOR WORD, the sentences that state an OBLIGATION or CONDITION the policyholder must satisfy to keep their side of the contract — for example: a required lock standard, where valuables must be kept, safety or maintenance duties, a time limit to report a claim, documents they must keep, an occupancy/vacancy condition.

STRICT RULES — follow EVERY one:
- Quote EXACTLY as written. Never paraphrase, summarise, shorten, translate, correct, or "improve" a quote. If the document is in German, keep it in German.
- Do NOT state, imply, or hint at whether anything is or is not covered.
- Do NOT give advice, recommendations, opinions, warnings, or next steps.
- Do NOT assess claims, likelihood of payout, adequacy, suitability, or price.
- Do NOT invent, infer, guess, or complete any text that is not literally present in what the user gave you. If nothing qualifies, return an empty list.
- Each quote gets one neutral topic tag from EXACTLY this set: Lock, Storage, Travel, Safety, Deadline, Documents, General.
Return ONLY valid JSON, no markdown: { "obligations": [ { "quote": string, "topic": string } ] }`;
const OBLIGATION_TOPICS = ['Lock', 'Storage', 'Travel', 'Safety', 'Deadline', 'Documents', 'General'];

app.post('/api/insurance-read', async (req, res) => {
  try {
    if (!FEATURE_INSURANCE_READER) return res.status(403).json({ error: 'This feature is not available yet.' });
    if (!AI_READY) return res.status(500).json({ error: 'AI is not configured on the server.' });

    const caller = await requireMember(req);
    if (caller.error) return res.status(caller.status).json({ error: caller.error });
    if (aiRateLimited(caller.uid)) return res.status(429).json({ error: 'Too many requests — please wait a minute and try again.' });
    const gateErr = aiGateBlocked(caller);
    if (gateErr) return res.status(403).json({ error: gateErr });

    console.log('[insurance-read] request from', caller.email);

    const { image, text } = req.body || {};
    const hasImage = image && image.data && image.mimeType;
    const hasText = typeof text === 'string' && text.trim().length > 0;
    if (!hasImage && !hasText) return res.status(400).json({ error: 'No document provided.' });

    const parts = [{ text: 'Quote the policyholder obligations from this policy, following every rule exactly.' }];
    if (hasText) parts.push({ text: `POLICY TEXT:\n${text.slice(0, 30000)}` });
    if (hasImage) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });

    const gRes = await generateContent(MODEL_TEXT, {
      systemInstruction: { parts: [{ text: INSURANCE_READ_SYSTEM }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    });

    const gData = await gRes.json();
    const outText = (gData?.candidates?.[0]?.content?.parts || []).find((p) => p.text)?.text;
    if (!outText) {
      console.error('[insurance-read] empty response:', JSON.stringify(gData).slice(0, 400));
      return res.status(502).json({ error: 'Could not read the document — please try again or type the conditions in manually.' });
    }

    let parsed;
    try { parsed = JSON.parse(outText); }
    catch { return res.status(502).json({ error: 'Could not parse the result — please try again.' }); }

    // Whitelist-shape the output: keep only a verbatim quote + a known topic tag.
    // Anything the model returned outside this shape (a stray "advice"/"covered"
    // field, an unknown topic) is dropped here, not stored.
    //
    // STRUCTURAL VERBATIM ENFORCEMENT (recall-only invariant): on the text path
    // we drop any "quote" that is not a literal substring of the document the
    // user gave us — so a paraphrase, verdict, or advice sentence the model
    // might hallucinate cannot ride inside the quote field and be shown as a
    // real extract. The image/OCR path cannot be checked against source text, so
    // those quotes are flagged verified:false and the UI marks them "from photo".
    const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
    const docNorm = hasText ? norm(text) : '';
    const seen = new Set();
    const obligations = Array.isArray(parsed?.obligations)
      ? parsed.obligations
          .map((o) => {
            const quote = typeof o?.quote === 'string' ? o.quote.trim().slice(0, 600) : '';
            return {
              quote,
              topic: OBLIGATION_TOPICS.includes(o?.topic) ? o.topic : 'General',
              verified: hasText ? (quote.length > 0 && docNorm.includes(norm(quote))) : false,
            };
          })
          .filter((o) => o.quote.length > 0)
          // text path: keep ONLY quotes literally present in the document
          .filter((o) => !hasText || o.verified)
          // dedupe within the batch (a document that repeats a clause -> one row)
          .filter((o) => { const k = norm(o.quote); if (seen.has(k)) return false; seen.add(k); return true; })
          .slice(0, 40)
      : [];

    res.json({ obligations });
  } catch (e) {
    console.error('[insurance-read] error', e);
    res.status(502).json({ error: 'Something went wrong reading the document — please try again.' });
  }
});

// Fun AI avatar restyler ("Nano Banana"). Each preset is a fixed image-to-image
// prompt applied to the member's own photo.
const AVATAR_STYLES = {
  pixar: 'Transform this person into a friendly 3D Pixar / Disney-style animated character. Keep their recognisable face, hairstyle, hair colour and skin tone. Warm cinematic lighting, soft rounded shapes, big expressive eyes. Clean simple background.',
  watercolor: 'Repaint this person as a soft watercolour portrait — loose expressive brush strokes, gentle washes of colour, textured-paper feel. Keep their recognisable features, hairstyle and colouring. Light, simple background.',
  renaissance: 'Repaint this person as a classical Renaissance oil portrait in the style of the old masters — dramatic chiaroscuro lighting, rich dark background, period painterly feel — but keep their recognisable modern face and hairstyle.',
  superhero: 'Reimagine this person as a heroic comic-book superhero — bold cel-shaded comic art, dynamic lighting, confident expression. Keep their recognisable face and hairstyle. Simple background.',
  lego: 'Transform this person into a LEGO minifigure of themselves — glossy plastic toy look, characteristic LEGO minifigure head and a hairpiece matching their hairstyle and colour, studio lighting, simple background.',
  clay: 'Transform this person into a cute claymation / stop-motion clay character — handmade plasticine texture, soft studio lighting. Keep their recognisable features. Simple background.',
};

app.post('/api/restyle-avatar', async (req, res) => {
  try {
    if (!AI_READY) return res.status(500).json({ error: 'AI is not configured on the server.' });

    const caller = await requireMember(req);
    if (caller.error) return res.status(caller.status).json({ error: caller.error });
    if (aiRateLimited(caller.uid)) return res.status(429).json({ error: 'Too many requests — please wait a minute and try again.' });
    const gateErr = aiGateBlocked(caller);
    if (gateErr) return res.status(403).json({ error: gateErr });

    const { image, style } = req.body || {};
    if (!image || !image.data || !image.mimeType) {
      return res.status(400).json({ error: 'No photo provided.' });
    }
    const stylePrompt = AVATAR_STYLES[style];
    if (!stylePrompt) return res.status(400).json({ error: 'Unknown style.' });

    console.log('[restyle-avatar]', style, 'from', caller.email);

    const prompt = `${stylePrompt}\n\nProduce ONE square, head-and-shoulders portrait suitable as a profile picture. It must clearly still be the same person. Keep it family-friendly and flattering.`;

    const gRes = await generateContent(MODEL_IMAGE, {
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType: image.mimeType, data: image.data } },
        ],
      }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    });

    if (!gRes.ok) {
      const detail = await gRes.text().catch(() => '');
      console.error('[restyle-avatar] gemini error', gRes.status, detail.slice(0, 300));
      return res.status(502).json({ error: `Could not generate the avatar (AI error ${gRes.status}) — please try again.` });
    }

    const gData = await gRes.json();
    let outData = null;
    for (const c of gData?.candidates || []) {
      for (const p of c?.content?.parts || []) {
        const inl = p.inlineData || p.inline_data;
        if (inl?.data) outData = inl.data;
      }
    }
    if (!outData) {
      console.error('[restyle-avatar] no image:', JSON.stringify(gData).slice(0, 300));
      return res.status(502).json({ error: 'The AI didn\'t return an image — please try again or pick another style.' });
    }

    res.json({ image: `data:image/png;base64,${outData}` });
  } catch (e) {
    console.error('[restyle-avatar] error', e);
    res.status(502).json({ error: 'Something went wrong creating the avatar — please try again.' });
  }
});

// ---------------------------------------------------------------------------
// Secrets-vault encryption (passwords / wifi / door codes). The key lives in
// Secret Manager and only the server holds it, so the ciphertext stored in
// Firestore is useless to anyone who reads the database. Values are tagged
// 'enc:1:' — any legacy plaintext passes through untouched and gets encrypted
// on its next save (graceful migration, no data loss).
const VAULT_KEY = (() => {
  const raw = process.env.VAULT_ENC_KEY || '';
  if (!raw) return null;
  const buf = Buffer.from(raw, 'base64');
  return buf.length === 32 ? buf : crypto.createHash('sha256').update(raw).digest();
})();

function encryptSecret(plain) {
  if (!VAULT_KEY || typeof plain !== 'string' || plain === '' || plain.startsWith('enc:1:')) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', VAULT_KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

function decryptSecret(v) {
  if (typeof v !== 'string' || !v.startsWith('enc:1:') || !VAULT_KEY) return v; // legacy plaintext / empty
  try {
    const [, , ivB, tagB, ctB] = v.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', VAULT_KEY, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return ''; // corrupt/undecryptable — return empty rather than leak ciphertext
  }
}

app.post('/api/vault/protect', async (req, res) => {
  try {
    const caller = await requireMember(req);
    if (caller.error) return res.status(caller.status).json({ error: caller.error });
    if (!VAULT_KEY) return res.status(500).json({ error: 'Secret encryption is not configured on the server.' });
    const values = Array.isArray(req.body?.values) ? req.body.values : [];
    res.json({ values: values.map(encryptSecret) });
  } catch (e) {
    console.error('[vault/protect]', e);
    res.status(500).json({ error: 'Could not secure those values.' });
  }
});

app.post('/api/vault/reveal', async (req, res) => {
  try {
    const caller = await requireMember(req);
    if (caller.error) return res.status(caller.status).json({ error: caller.error });
    const values = Array.isArray(req.body?.values) ? req.body.values : [];
    res.json({ values: values.map(decryptSecret) });
  } catch (e) {
    console.error('[vault/reveal]', e);
    res.status(500).json({ error: 'Could not read those values.' });
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

// ---------------------------------------------------------------------------
// Babysitter / carer share links. An admin/member generates a time-limited,
// revocable link showing ONLY carer-safe info (allergies, meds, conditions,
// doctor, school, emergency contacts) for the children — NEVER passwords,
// passports, ID/e-card numbers or finances. The snapshot is frozen at creation
// and whitelisted server-side, so nothing sensitive can be smuggled in; the
// public page is server-rendered (no auth, no SPA, no client Firestore access).
// ---------------------------------------------------------------------------
const CARER_MAX_HOURS = 24 * 7;       // 7 days
const CARER_DEFAULT_HOURS = 48;

const clip = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

// Keep ONLY the whitelisted carer-safe fields — silently drop anything else.
function sanitizeCarerSnapshot(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const children = (Array.isArray(o.children) ? o.children : []).slice(0, 12).map((c) => ({
    name: clip(c?.name, 80),
    age: clip(c?.age, 24),
    allergies: clip(c?.allergies, 500),
    medications: clip(c?.medications, 500),
    conditions: clip(c?.conditions, 500),
    doctor: clip(c?.doctor, 240),
    school: clip(c?.school, 240),
    notes: clip(c?.notes, 500),
  }));
  const contacts = (Array.isArray(o.contacts) ? o.contacts : []).slice(0, 8).map((c) => ({
    name: clip(c?.name, 80),
    phone: clip(c?.phone, 40),
    relation: clip(c?.relation, 60),
  }));
  return { children, contacts, householdNote: clip(o.householdNote, 500) };
}

app.post('/api/carer-share/create', async (req, res) => {
  try {
    const caller = await requireMember(req);
    if (caller.error) return res.status(caller.status).json({ error: caller.error });
    if (caller.role === 'child') return res.status(403).json({ error: 'Only parents can create a carer link.' });
    const body = req.body || {};
    const snapshot = sanitizeCarerSnapshot(body.snapshot);
    if (!snapshot.children.length && !snapshot.contacts.length) {
      return res.status(400).json({ error: 'Nothing to share yet — add some carer info first.' });
    }
    let hours = Number(body.hours);
    if (!Number.isFinite(hours) || hours <= 0) hours = CARER_DEFAULT_HOURS;
    hours = Math.min(hours, CARER_MAX_HOURS);
    const token = crypto.randomBytes(24).toString('base64url');
    const now = Date.now();
    const expiresAt = new Date(now + hours * 3600 * 1000).toISOString();
    await adminDb.doc(`carerShares/${token}`).set({
      familyId: caller.familyId,
      createdBy: caller.uid,
      createdByName: caller.displayName || '',
      createdAt: new Date(now).toISOString(),
      expiresAt,
      revoked: false,
      snapshot,
    });
    res.json({ ok: true, token, path: `/carer/${token}`, expiresAt });
  } catch (err) {
    console.error('/api/carer-share/create error:', err);
    res.status(500).json({ error: 'Could not create the link. Please try again.' });
  }
});

app.post('/api/carer-share/revoke', async (req, res) => {
  try {
    const caller = await requireMember(req);
    if (caller.error) return res.status(caller.status).json({ error: caller.error });
    const token = clip((req.body || {}).token, 200);
    if (!token) return res.status(400).json({ error: 'Missing link id.' });
    const ref = adminDb.doc(`carerShares/${token}`);
    const snap = await ref.get();
    if (!snap.exists) return res.json({ ok: true });
    if (snap.data().familyId !== caller.familyId) return res.status(403).json({ error: 'That link is not yours.' });
    await ref.set({ revoked: true }, { merge: true });
    res.json({ ok: true });
  } catch (err) {
    console.error('/api/carer-share/revoke error:', err);
    res.status(500).json({ error: 'Could not revoke the link.' });
  }
});

app.get('/api/carer-share/list', async (req, res) => {
  try {
    const caller = await requireMember(req);
    if (caller.error) return res.status(caller.status).json({ error: caller.error });
    const q = await adminDb.collection('carerShares').where('familyId', '==', caller.familyId).get();
    const now = Date.now();
    const shares = [];
    q.forEach((d) => {
      const v = d.data();
      if (v.revoked || (v.expiresAt && new Date(v.expiresAt).getTime() < now)) return;
      shares.push({ token: d.id, createdAt: v.createdAt, expiresAt: v.expiresAt, childCount: (v.snapshot?.children || []).length });
    });
    shares.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ shares });
  } catch (err) {
    console.error('/api/carer-share/list error:', err);
    res.status(500).json({ error: 'Could not load links.' });
  }
});

// HTML-escape everything rendered into the public carer page (prevents any
// stored family text from becoming markup/script).
function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function carerShell(inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Carer sheet</title>
<style>
  :root{--ink:#2b2a28;--muted:#8a857d;--line:#eceae5;--bg:#f6f5f1;--rosa:#b23b47;--sage:#2e7d5b;}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    -webkit-font-smoothing:antialiased;line-height:1.5;padding:16px}
  .wrap{max-width:520px;margin:0 auto}
  .banner{background:#eaf5ef;color:var(--sage);border:1px solid #cfe9dd;border-radius:14px;
    padding:10px 14px;font-size:13px;font-weight:600;margin-bottom:14px}
  .card{background:#fff;border:1px solid var(--line);border-radius:20px;padding:18px 18px;margin-bottom:14px}
  h1{font-size:22px;font-weight:800;margin:2px 0 2px}
  .sub{color:var(--muted);font-size:13px;margin:0 0 16px}
  .name{font-size:19px;font-weight:800;margin:0}
  .age{color:var(--muted);font-size:13px;font-weight:600;margin-left:6px}
  .lbl{font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:12px 0 2px}
  .val{font-size:15px;margin:0}
  .alrg{background:#fbe9ea;border:1px solid #f3cdd1;border-radius:12px;padding:10px 12px;margin-top:10px}
  .alrg .lbl{color:var(--rosa)}.alrg .val{color:var(--rosa);font-weight:700;font-size:16px}
  .none{color:var(--muted);font-style:italic;font-size:13px}
  a.tel{color:var(--sage);font-weight:700;text-decoration:none}
  .foot{color:var(--muted);font-size:12px;text-align:center;margin:18px 4px 8px}
  .exp{background:#fff;border:1px solid var(--line);border-radius:20px;padding:28px 20px;text-align:center}
</style></head><body><div class="wrap">${inner}</div></body></html>`;
}

function carerPage(v) {
  const snap = v.snapshot || {};
  const exp = v.expiresAt ? new Date(v.expiresAt) : null;
  const children = (snap.children || []).map((c) => {
    const rows = [];
    rows.push(`<p class="name">${esc(c.name || 'Child')}${c.age ? `<span class="age">${esc(c.age)}</span>` : ''}</p>`);
    rows.push(c.allergies
      ? `<div class="alrg"><p class="lbl">Allergies</p><p class="val">${esc(c.allergies)}</p></div>`
      : `<p class="lbl">Allergies</p><p class="none">None on file.</p>`);
    if (c.medications) rows.push(`<p class="lbl">Medications</p><p class="val">${esc(c.medications)}</p>`);
    if (c.conditions) rows.push(`<p class="lbl">Conditions</p><p class="val">${esc(c.conditions)}</p>`);
    if (c.doctor) rows.push(`<p class="lbl">Doctor</p><p class="val">${esc(c.doctor)}</p>`);
    if (c.school) rows.push(`<p class="lbl">School</p><p class="val">${esc(c.school)}</p>`);
    if (c.notes) rows.push(`<p class="lbl">Notes</p><p class="val">${esc(c.notes)}</p>`);
    return `<div class="card">${rows.join('')}</div>`;
  }).join('');
  const contacts = (snap.contacts || []).length
    ? `<div class="card"><p class="lbl" style="margin-top:0">Emergency contacts</p>${
        snap.contacts.map((ct) => `<p class="val" style="margin-top:6px">${esc(ct.name || '')}${
          ct.relation ? ` <span class="age">${esc(ct.relation)}</span>` : ''}${
          ct.phone ? ` — <a class="tel" href="tel:${esc(ct.phone.replace(/\s+/g, ''))}">${esc(ct.phone)}</a>` : ''}</p>`).join('')
      }</div>`
    : '';
  const household = snap.householdNote ? `<div class="card"><p class="lbl" style="margin-top:0">Good to know</p><p class="val" style="margin-top:6px">${esc(snap.householdNote)}</p></div>` : '';
  const inner = `
    <div class="banner">Temporary carer sheet — safe to view. No passwords, passports or ID numbers are shared here.</div>
    <div class="card"><h1>Carer info</h1><p class="sub">Everything a sitter needs for the kids.</p></div>
    ${children}${contacts}${household}
    <p class="foot">Shared privately${v.createdByName ? ` by ${esc(v.createdByName)}` : ''}${exp ? ` · expires ${esc(exp.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}` : ''}.</p>`;
  return carerShell(inner);
}

function carerErrorPage() {
  return carerShell(`<div class="exp"><h1>Link expired</h1><p class="sub" style="margin-top:8px">This carer link has expired or been turned off. Ask the family to share a new one.</p></div>`);
}

// Public, unauthenticated carer page — MUST be registered before the SPA catch-all.
app.get('/carer/:token', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  try {
    const token = String(req.params.token || '').slice(0, 200);
    const snap = await adminDb.doc(`carerShares/${token}`).get();
    const v = snap.exists ? snap.data() : null;
    const expired = !!(v && v.expiresAt && new Date(v.expiresAt).getTime() < Date.now());
    if (!v || v.revoked || expired) return res.status(410).send(carerErrorPage());
    return res.send(carerPage(v));
  } catch (err) {
    console.error('/carer render error:', err);
    return res.status(500).send(carerErrorPage());
  }
});

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
