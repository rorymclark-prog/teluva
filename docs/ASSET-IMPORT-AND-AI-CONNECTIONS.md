# Asset capture and AI connections

Rory's requested experience: connect a source once, let AI find the purchase
evidence, and review the few details that need a human decision. This plan is
separate from the asset-register release; it does not claim a desktop scanner
or public chatbot connector has shipped.

## Recommended order

1. **One import inbox inside Teluva.** Reuse the existing scanner, protected
   vault, Google Drive picker, inbound email and Gmail bridge. Accept selected
   files or folders where the browser supports it. Keep the originals. Extract
   suggested purchase fields and warranty records, cite the source page or
   passage, identify likely existing assets, and offer a concise review before
   applying a batch. Treat uncertain dates as unknown. Do not infer an expiry
   from a purchase date, retailer name or consumer-law assumption.
2. **A Teluva connector.** Expose narrowly scoped search, fetch, propose-asset,
   link-evidence and apply-reviewed-import operations. Bind every operation to
   the authenticated account, selected space and current role. Use OAuth and
   revocable grants; a chatbot subscription is not authorization to access a
   person's files or another provider's connections. Keep source access separate
   from authorization to write into Teluva. Reuse the same import pipeline and
   validation rather than duplicating business logic for each AI provider.
3. **An optional desktop companion.** For repeated discovery across local
   folders, let the user choose read-only roots and see what will be indexed.
   Start with filename/type/date matching and local text extraction, with
   content upload and AI processing explained before use. Add background
   watching only for opted-in folders. Arbitrary mouse/keyboard control is not
   required to discover documents and is a less predictable primary interface.

## Device boundaries

- A web app can offer a folder picker in supporting browsers, after a user
  action, over HTTPS. It cannot assume universal browser support or freely
  search an entire computer. An installed PWA does not itself grant unrestricted
  file access. Provide a multi-file upload fallback.
- On phones, use selected Files/document-provider folders, camera scanning,
  share-sheet imports and separately connected cloud sources. Native mobile
  permissions determine which files are available; do not promise a silent
  device-wide scan.
- A desktop app can support explicitly permitted folders and background
  indexing. It still needs platform permissions, packaging, signing, updates,
  connection revocation and a visible review of discovered documents.

## ChatGPT and Gemini

OpenAI's official plugin/MCP guidance supports authenticated tools for live
data and controlled actions. A Teluva MCP server can let ChatGPT or Codex find
records and prepare imports without requiring a custom visual interface.
Public availability still requires the applicable hosting, authentication and
publication work; there is no published Teluva connector in this release.

Gemini's API supports function calling into application code and external
APIs. That supports the same Teluva operations through an integration we build.
It does not establish that anyone can install a third-party Teluva extension
inside the consumer Gemini app in the same way as a ChatGPT plugin.

## Import behaviour

- Deduplicate by original content hash, then suggest asset matches using exact
  serial/order identifiers before weaker name/model matches.
- Keep the suggested value, evidence reference and user confirmation distinct.
  Preserve original files even when extracting text fails.
- Never invent warranty duration, legal rights, insurance cover or valuations.
  Separate commercial warranties, returns, legal purchase context and insurance.
- Let the user select family or business for each batch. Avoid moving a file or
  granting shared access simply because a model suggests it belongs elsewhere.
- Show progress, unavailable files and failed items. Make retry idempotent and
  prevent duplicate writes. Keep an import audit trail and support corrections.
- Treat document text as source data, never as instructions granting new access
  or overriding the user's requested filing operation.

## Sources checked 31 October 2026

- [MDN: folder picker, permissions and limited browser availability](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)
- [Apple: providing access to selected directories](https://developer.apple.com/documentation/uikit/providing-access-to-directories)
- [OpenAI: building an authenticated MCP server](https://developers.openai.com/apps-sdk/build/mcp-server)
- [Google: function calling with the Gemini API](https://ai.google.dev/gemini-api/docs/function-calling)
