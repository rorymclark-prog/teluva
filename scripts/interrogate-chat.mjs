/* Interrogate the CHAT's decision to open the document reader.
 *
 * WHY THIS EXISTS
 * ---------------
 * scripts/interrogate-reader.mjs proves the reader answers well ONCE IT IS
 * ASKED. It says nothing about the step before it: the chat model deciding to
 * emit "readDoc" at all. That step failed silently in production — the reply
 * said "I'll check your Home Lease Agreement", readDoc came back null, and the
 * user sat looking at a promise that never resolved. Nothing in the app or the
 * test suite could see it, because a missing optional field is not an error.
 *
 * So this runs the REAL system prompt (read out of server.js, not a copy)
 * against the REAL model and asserts on the JSON: was readDoc set, and did the
 * whole question survive into readDoc.question?
 *
 * The cases that matter are the CONVERSATIONAL ones. A question asked into an
 * empty thread was never the failure; a question asked into a thread that
 * already contains a read is, because the frozen "Reading … now" line in the
 * history reads to the model as "you already did this".
 *
 * USAGE
 *   node scripts/interrogate-chat.mjs [caseId ...]
 *
 * Requires application-default credentials with Vertex access.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleAuth } from 'google-auth-library';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// The prompt, lifted verbatim from the running source. If server.js stops
// declaring it this way the harness fails loudly rather than testing a stale copy.
const START = SRC.indexOf('const SYSTEM_INSTRUCTION = `');
if (START < 0) throw new Error('SYSTEM_INSTRUCTION not found in server.js');
const body = SRC.slice(START + 'const SYSTEM_INSTRUCTION = `'.length);
const END = body.indexOf('`;\n');
if (END < 0) throw new Error('SYSTEM_INSTRUCTION terminator not found');
const RAW = body.slice(0, END);
if (RAW.includes('${')) throw new Error('SYSTEM_INSTRUCTION now interpolates — update this harness');

// Family space: the same substitutions server.js makes at request time.
const SYSTEM = RAW
  .replace('__ROLE_ENUM__', '"Parent"|"Child"|"Grandparent"|"Other"')
  .replace('__ROLE_GUIDANCE__', 'Use "role" values "Parent", "Child", "Grandparent", or "Other" — never a job title here.')
  .replace('__CV_EDIT_LINE__', '')
  .replace('__CV_RULE_LINE__', '');

const MODEL = process.env.CHAT_MODEL
  || (SRC.match(/const MODEL_SMART = process\.env\.MODEL_SMART \|\| '([^']+)'/)?.[1] ?? 'gemini-2.5-pro');

/* Ids are the app's real shape: 16-digit strings minted from Date.now(), not
 * tidy slugs. That distinction is the whole point of this file — the model has
 * to reproduce one EXACTLY or sanitizeReadDoc drops it and the reader silently
 * never opens. A fixture with "doc-lease-001" in it tests nothing.
 * DOCS_FILE lets you run against a real vault's list without committing it. */
const DEFAULT_DOCS = [
  { id: '1785493248830419', name: 'Home Lease Agreement - Treustraße 54', category: 'Legal', location: 'shared vault only', uploadedAt: '2026-07-20' },
  { id: '1784614558820564', name: "Rory and Maria's Romanian Marriage Certificate", category: 'Legal', location: 'shared vault only', uploadedAt: '2026-07-01' },
  { id: '1784578281431237', name: 'Rory Michael Clark UK Passport', category: 'Identity', location: "on Rory's profile", uploadedAt: '2026-06-30' },
  { id: '1781850807102478', name: 'Rory Clark - Rosuvastatin/Ezetimib HCS Medication', category: 'Medical', location: 'shared vault only', uploadedAt: '2026-06-01' },
];
const DOCS = process.env.DOCS_FILE
  ? JSON.parse(fs.readFileSync(process.env.DOCS_FILE, 'utf8'))
  : DEFAULT_DOCS;
const LEASE_ID = DOCS.find((d) => /lease/i.test(d.name))?.id;
if (!LEASE_ID) throw new Error('no lease in the documents list');

const CONTEXT = {
  isBusinessSpace: false,
  familyName: 'Clark',
  members: [{ id: 'm1', name: 'Rory', role: 'Parent' }],
  documents: DOCS,
};

const Q = 'i want to know under what conditions i can call a electrician or plumber for repairs';
// The line the app itself writes into a read message, and therefore the line
// that goes back to the model as history on the NEXT turn. Verbatim from
// readingLine() in src/components/AIChatbot.tsx.
const READING_LINE = 'Reading “Home Lease Agreement - Treustraße 54” for “what does my lease say about repairs” now — you\'ll see the document\'s own wording, not mine.';

const CASES = [
  { id: 'fresh', history: [], wantRead: LEASE_ID },
  {
    id: 'after-one-read',
    wantRead: LEASE_ID,
    history: [
      { role: 'user', text: 'what does my lease say about repairs' },
      { role: 'assistant', text: READING_LINE },
    ],
  },
  {
    id: 'after-refusal',   // the exact shape of Rory's broken thread
    wantRead: LEASE_ID,
    history: [
      { role: 'user', text: 'what does my lease say about repairs' },
      { role: 'assistant', text: READING_LINE },
      { role: 'user', text: 'and about the plumber' },
      { role: 'assistant', text: "I've already highlighted the relevant sections about repairs. I don't get to see the contents myself, but I can open it for you again if you'd like." },
    ],
  },
  {
    id: 'follow-up-narrower',
    wantRead: LEASE_ID,
    q: 'ok and what about the boiler specifically',
    history: [
      { role: 'user', text: Q },
      { role: 'assistant', text: READING_LINE },
    ],
  },
  {
    // Not every mention of a document is a content question — "do I have it"
    // must NOT open the reader, or the button becomes noise.
    id: 'existence-only', wantRead: null,
    q: 'do i have my lease saved anywhere',
    history: [],
  },
];

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const client = await auth.getClient();
const PROJECT = process.env.VERTEX_PROJECT || 'gen-lang-client-0384516171';
const LOCATION = process.env.VERTEX_LOCATION || 'europe-west1';

async function run(c) {
  const token = (await client.getAccessToken()).token;
  const question = c.q || Q;
  const contents = [
    ...c.history.map((h) => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] })),
    { role: 'user', parts: [{ text: `FAMILY DATA:\n${JSON.stringify(CONTEXT)}\n\nUSER: ${question}` }] },
  ];
  const res = await fetch(
    `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents,
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
    },
  );
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(`HTTP ${res.status} ${JSON.stringify(j.error || j).slice(0, 300)}`);
  const text = (j?.candidates?.[0]?.content?.parts || []).find((p) => p.text)?.text;
  if (!text) throw new Error(`no text (finishReason ${j?.candidates?.[0]?.finishReason})`);
  return JSON.parse(text);
}

const only = process.argv.slice(2);
let failed = 0;
for (const c of CASES) {
  if (only.length && !only.includes(c.id)) continue;
  let out;
  try { out = await run(c); }
  catch (e) { console.log(`\n### ${c.id} — ERROR ${e.message}`); failed++; continue; }

  const got = out.readDoc?.id || null;
  const problems = [];
  if (c.wantRead && got !== c.wantRead) problems.push(got ? `opened the wrong document (${got})` : 'readDoc NULL — the reader never opens');
  if (!c.wantRead && got) problems.push(`opened the reader on a question that only asked whether a document exists`);
  if (c.wantRead && got === c.wantRead) {
    // v194's rule: the whole question, not a keyword.
    const q = String(out.readDoc.question || '');
    if (q.split(/\s+/).filter(Boolean).length < 4) problems.push(`question reduced to a keyword: ${JSON.stringify(q)}`);
  }
  console.log(`\n### ${c.id} ${problems.length ? '❌ ' + problems.join('; ') : '✅'}`);
  console.log(`   reply: ${String(out.reply || '').slice(0, 180)}`);
  if (out.readDoc) console.log(`   readDoc.question: ${JSON.stringify(out.readDoc.question)}`);
  if (problems.length) failed++;
}
console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}  (model ${MODEL})`);
process.exit(failed === 0 ? 0 : 1);
