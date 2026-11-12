# Life Atlas v391

The existing `travelTimeline` route and shared reference document now open a Life Atlas. Existing travel entries are read in place; no migration or household mutation is required.

## Behavior

- Local Natural Earth geography renders a rotatable orthographic globe and a pan/zoom 2D map without a map service, external tiles or geocoding requests.
- Homes, holidays, visits and events have a cover, story, participants, optional date range and optional precise pin. Unknown dates and coordinates remain unknown. Month/year precision is retained in the family timeline; increasing precision requires a new date.
- Device/Apple Photos exports are inspected for capture EXIF and GPS before generating a JPEG cover. At most 20 selected photos, each at most 20 MB, are processed sequentially. Nearby photos on the same known date start as alternative covers, with explicit review before upload/save.
- Google Photos is an optional separate Picker-only OAuth grant, requested from a user click. It is not added to normal sign-in, Drive or Calendar scopes. Tokens, session URLs and temporary media URLs stay in memory. Selected bytes use authorized Google-only URLs, bounded streams, request timeouts and abortable polling. Sessions are deleted after use or cancellation.
- Google Photos removes location metadata even for `=d` downloads. Its imports have no inferred GPS or country; the user supplies a pin. Local exports may retain GPS. The app saves display covers, not an original-photo archive.
- Adult write permissions and account/space/panel fences cover preparation, Google selection, upload and adoption. Saves use the captured merge base. Failed saves keep the draft and any successfully uploaded cover for retry. Removing an Atlas entry retains its protected photo.
- Business spaces show a family-space notice without loading Atlas data.

## Verification and limits

Focused utility and actual React interaction suites cover metadata order, unknown/approximate dates, legacy entries, timeline propagation, map projection/inversion, rear-hemisphere pins, bounded imports, per-file failures, explicit review, failed-save retry without a second upload, read-only/business gates and account switching. Google client fixtures cover polling intervals/timeout, cleanup, URL fencing, byte/item limits and cancellation. The normal deployment script runs all existing release gates.

Supported Chrome QA used the actual Atlas, actual map, actual AppearanceProvider and built app CSS with synthetic database/account/Photos boundaries. Checked globe/map switching, map selection/details, mobile manual pin placement, Google-result review, year-only date editing and explicit save. A 390×844 dark viewport had no horizontal overflow and all covers loaded. Desktop light was also inspected. This is responsive Chrome testing, not a physical-phone test. The preview tab and owned HTTP server were closed afterward; screenshots and process evidence are in ignored `output/verification/life-atlas-2026-11-12/`.

The Photos Picker API was enabled in the existing Google Cloud project. No real Google Photos account was authorized and no private photos were imported during development. Live Google consent, account-specific OAuth configuration and selected-photo download still require verification through a user's connection; a clear permission/configuration error leaves device imports available. No unattended scanning, AI photo ranking, WhatsApp access, recurring jobs or new AI-provider calls are introduced.

Primary references: [Google Picker flow](https://developers.google.com/photos/picker/guides/get-started-picker), [session configuration](https://developers.google.com/photos/picker/reference/rest/v1/sessions), [authorized media bytes and location stripping](https://developers.google.com/photos/picker/guides/media-items), [D3 orthographic projection](https://d3js.org/d3-geo/azimuthal), [Natural Earth world-atlas data](https://github.com/topojson/world-atlas).
