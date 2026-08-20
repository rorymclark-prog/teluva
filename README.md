# Teluva

A private vault for the things a family actually needs to find: passports and
their expiry dates, blood groups and allergies, the orthodontist's number, who
holds the spare key, what the will says and where it is.

It is one household's real records, not a demo. Everything below was built
against that.

**Live:** https://teluva-x3k4bua7pq-nw.a.run.app

---

## What it does

**Records.** Family members with identity documents, medical details, sizes,
education, travel documents and work details. Household records — utilities,
vehicles, pets, service history, keys and codes. A shared directory of doctors,
dentists, tradespeople and advisers.

**Documents.** Scan or upload anything. Vision OCR reads it, and a document
reader answers questions about it by returning offsets into the text so the
server slices the actual quote — the model never gets to paraphrase a contract
back at you as fact.

**An assistant that files things.** Tell it "Ganga's new passport expires in
March 2031" and it proposes a change to the right field. Nothing is written
until you tap Apply. What the assistant may and may not write is a fixed set of
edit kinds, guarded by a test — a field with no edit kind is invisible to it,
and that has shipped as a silent bug more than once.

**A calendar that knows who people are.** Two-way Google Calendar sync, ICS
feeds, birthdays and anniversaries, Austrian name days plus researched name
celebrations for names no saint's calendar covers, and appointment matching that
reads a member out of an imported event title without matching "Vita" inside
"Vitamin".

**Wills and estate.** Locked records with their own Firestore rules, an invite
that carries its own grant, and a separate store for the locksmith-level details
that must not live inside the locked document.

**In Memory.** Archived profiles for people who have died, with their documents
and dates kept rather than deleted.

Offline-capable PWA. Field-level encryption at rest for the sensitive columns.
Push notifications for birthdays and expiries.

## Stack

React 19 + TypeScript + Vite on the front, a single Express `server.js` behind
it, Firebase for auth/Firestore/Storage, Gemini for the assistant and OCR, all
on Cloud Run in `europe-west2`.

Membership is server-only: the server mints custom claims (`familyId`,
`familyIds`) and the security rules read those. A client cannot write its own
role or family.

## Running it

```bash
npm install
npm run dev
```

You will need your own Firebase project and a `GEMINI_API_KEY`. The two Google
API keys in this repo are browser keys that ship in the client bundle by
design — they are not secrets, and they are referrer-restricted. Every actual
secret comes from Secret Manager and none of them are here.

## Tests

```bash
npm test
```

No test runner. Each file is a standalone `node:assert` script listed in the
`test` script, and a large share of them are *source-as-text* tests: they read
the source and assert that a rule is still written in it. That sounds strange
until you have watched a prompt promise a capability the code never had, or a
field render beautifully and never commit on Save. Those are the failures this
codebase keeps having, so those are the ones the tests are shaped around.

The house rule: every new assertion is verified to bite by deliberately
breaking the code and watching it fail, before it is trusted.

## Licence

None yet — all rights reserved. The code is public to read; it is not yet
offered under any licence to reuse.
