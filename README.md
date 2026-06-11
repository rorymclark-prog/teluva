# Family Info Organizer

Family information organizer app, built in **Google AI Studio** (Build mode) and deployed by it to Cloud Run.

- **Live URL:** https://family-info-organizer-1000796646145.europe-west2.run.app/
- **Stack:** React 19 + Vite + Tailwind 4, Firebase (data), Gemini via `@google/genai`, jsPDF for exports. `server.cjs` is just a zero-dependency static file shim for Cloud Run.

## Where the source of truth lives

⚠️ **This folder is the COMPILED build output (version-2), not the editable source.**

| What | Where |
|---|---|
| Editable source | AI Studio → https://aistudio.google.com/apps (applet `393d7146-0d1a-431e-bd58-b2a1478b5ff5`) |
| GCP project | `gen-lang-client-0384516171` (number `1000796646145`) |
| Cloud Run service | `family-info-organizer`, region `europe-west2` |
| Build artifacts | `gs://ai-studio-bucket-1000796646145-europe-west2/services/family-info-organizer/` (version-1 and version-2) |

To edit the app: open it in AI Studio, make changes, redeploy from there. To get the editable source under git, use AI Studio's download/GitHub export — then replace this compiled snapshot.

This snapshot fetched 2026-06-12 via:

```sh
gcloud storage cp gs://ai-studio-bucket-1000796646145-europe-west2/services/family-info-organizer/version-2/compiled/build_artifacts.tar.gz .
```

## Note on the embedded API key

`assets/index-*.js` contains a Firebase **web config** API key (`AIza…`). Firebase web keys are public by design (every visitor's browser downloads them); access control happens via Firebase security rules, not key secrecy. Not a credential leak.
