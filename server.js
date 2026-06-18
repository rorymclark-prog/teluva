import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import admin from 'firebase-admin';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0384516171';
const FIREBASE_AUTH_HOST = `${PROJECT_ID}.firebaseapp.com`;
const ALLOWED = (process.env.ALLOWED_EMAILS ||
  'rorymclark@gmail.com,partner@example.com,child@example.com')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

admin.initializeApp({ projectId: PROJECT_ID });

// --- Same-origin Firebase Auth helper proxy (keeps iOS Safari sign-in working) ---
// Mounted at root with a pathFilter so the FULL /__/auth/... path is forwarded
// (mounting on the path would strip the prefix and 404 on Firebase Hosting).
const authProxy = createProxyMiddleware({
  target: `https://${FIREBASE_AUTH_HOST}`,
  changeOrigin: true,
  pathFilter: ['/__/auth/**', '/__/firebase/**'],
});
app.use(authProxy);

app.use(express.json({ limit: '2mb' }));

const SYSTEM_INSTRUCTION = `You are the assistant inside a private family records app ("Family Vault").
You do two things:
1) ANSWER questions by recalling from the provided FAMILY DATA (read-only).
2) EXTRACT facts the user states into structured edits to store in the right place.

Output ONLY valid JSON of the form:
{"reply": string, "edits": Edit[]}

Edit is one of:
- {"kind":"member","member":<existing member name>,"field":<canonical key>,"value":<string>}
- {"kind":"passport","member":<name>,"country":<country>,"number":<string>,"expiry":<YYYY-MM-DD or "">}
- {"kind":"contact","name":<string>,"relation":<string>,"phone":<string>,"email":<string>}   // a shared family contact (school office, doctor, a friend, etc.)
- {"kind":"number","label":<string>,"value":<string>}                                          // a shared standalone reference number

Canonical member field keys (use ONLY these):
basic: name, nickname, birthdate, place_of_birth, nationality, languages, gender
sizes: shirt_size, pants_size, shoe_size, dress_size, jacket_size, hat_size, ring_size, height_cm, weight_kg, size_notes
medical: blood_group, allergies, medications, conditions, surgeries, emergency_medication, organ_donor, family_medical_history, medical_notes
identity: sv_number, ecard_number, tax_number, student_number, school_reg_number, residence_permit_number, residence_permit_expiry, national_id_number, citizenship_cert_number, drivers_license_number, drivers_license_expiry
education: school_name, class_grade, teacher_name, teacher_contact
travel: frequent_flyer, travel_insurance_number, etias_status, travel_preferences, emergency_travel_contact
emergency: emergency_contact_name, emergency_contact_phone
preferences: favorite_meals, disliked_foods, dietary_restrictions, favorite_movies, favorite_books, favorite_games, favorite_music, sports, hobbies, clothing_brands, color_preferences

RULES:
- If the user is ASKING/recalling: answer concisely from FAMILY DATA; edits = [].
- If the user is TELLING you info to store: produce edits and a short reply confirming what you'll set.
- "member" MUST match an existing family member name (case-insensitive). If you cannot tell which member, ASK in reply and return edits=[].
- Dates: YYYY-MM-DD. organ_donor value: "yes" or "no".
- Use kind "passport" for passports, "contact" for people/places to phone (school, doctor, friend), "number" for a loose reference number not tied to a person.
- NEVER invent data. If something needed is missing, ask for it in reply. Keep reply warm and brief.`;

app.post('/api/chat', async (req, res) => {
  try {
    if (!GEMINI_KEY) return res.status(500).json({ error: 'AI is not configured on the server.' });

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Please sign in first.' });

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch (e) {
      return res.status(401).json({ error: 'Your session expired — sign in again.' });
    }
    const email = (decoded.email || '').toLowerCase();
    if (!ALLOWED.includes(email)) {
      return res.status(403).json({ error: 'This assistant is limited to the family accounts.' });
    }

    const { message, context, history } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'No message.' });
    }

    const ctxJson = JSON.stringify(context ?? {}).slice(0, 120000);
    const contents = [
      ...((Array.isArray(history) ? history : []).slice(-8).map(h => ({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: String(h.text || '').slice(0, 4000) }],
      }))),
      { role: 'user', parts: [{ text: `FAMILY DATA (JSON):\n${ctxJson}\n\nUSER MESSAGE:\n${message}` }] },
    ];

    const gRes = await fetch(
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
    const gData = await gRes.json();
    const text = gData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.error('Gemini empty response:', JSON.stringify(gData).slice(0, 500));
      return res.status(502).json({ error: gData?.error?.message || 'The assistant did not respond.' });
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

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// --- Static SPA ---
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

app.listen(PORT, () => console.log(`Family Vault server listening on ${PORT}`));
