<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/393d7146-0d1a-431e-bd58-b2a1478b5ff5

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

(`GEMINI_API_KEY` is in the AI Studio template but nothing in `src/` uses it — no `.env.local` needed. Data lives in the production Firestore, so local dev reads/writes the same data as the live app.)

## Provenance / deployment

- **Live URL:** https://family-info-organizer-1000796646145.europe-west2.run.app/
- Built in Google AI Studio (applet `393d7146-0d1a-431e-bd58-b2a1478b5ff5`), GCP project `gen-lang-client-0384516171`, Cloud Run service `family-info-organizer` in `europe-west2`.
- This folder is the **editable source**, exported from AI Studio 2026-06-12 (Export → Download as .zip). Compiled deploy snapshot it replaced is in git history (commit 6a81cdc).
- ⚠️ Edits made here do NOT reach the live app automatically. Either paste changes back into AI Studio and redeploy there, or deploy directly (`gcloud run deploy family-info-organizer --source . --project gen-lang-client-0384516171 --region europe-west2`) — but mixing both means AI Studio's copy and this one diverge; pick one as source of truth.
- `firebase-applet-config.json` holds the Firebase **web** config (public by design; access control = `firestore.rules`).
