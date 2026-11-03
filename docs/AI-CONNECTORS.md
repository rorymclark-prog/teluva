# AI import inbox and chatbot connections

The family and business sections share a persistent **AI import inbox** and an
OAuth-protected remote MCP connector. The inbox keeps suggestions separate from
saved asset records. An administrator reviews asset/document records; each adult
approves their own language and appearance preferences.

## Import inside Teluva

Open **Vault → AI import inbox**. Select up to 20 original files per upload,
choose documents already in the Vault, or paste named source text. Existing
camera scanning, Drive import and email intake remain available through the
Vault. New original uploads use protected storage and the selected space.

Choose **Analyze source** to prepare a draft using Teluva's existing AI service and
AI preference. PDFs, JPEG/PNG/WebP images and plain text/CSV originals up to
12 MiB can be read. Larger or unsupported originals remain saved; relevant text
can be pasted instead. Pasted text is identified as text, not an original receipt.

Review purchase details, serial numbers and separate manufacturer, retailer and
extended warranties. Unknown fields stay empty. Warranty expiry is never guessed
from purchase date or a legal assumption. Asset drafts link their original file;
other document drafts update that original's Vault metadata. Exact serial-number
matches warn about possible duplicates. Retrying the same submission or applying
it again does not create another asset. A draft changed during AI processing is
preserved. Only an administrator can apply records; adult members can prepare
their own drafts. Children cannot use the inbox or connector.

## Connect ChatGPT or Claude

Use this remote MCP server URL:

```
https://teluva-x3k4bua7pq-nw.a.run.app/mcp
```

In ChatGPT, add a custom MCP server/plugin with OAuth authentication. In Claude,
add a custom connector with OAuth and automatic client registration. Provider
account and workspace policies determine availability; organization owners may
need to enable custom connectors. Teluva's **AI connections** screen includes
setup links and copyable instructions. This is a custom connector, not a claim
of approval or listing in either provider's public directory.

The chatbot opens Teluva's sign-in and consent screen. Choose one family or
business, the permitted actions, and specific Vault documents (up to 50).
Business document reading requires a business administrator. Adult employees
can prepare drafts and import explicitly provided originals without reading
existing saved documents. Imported originals retain their owner's protected
file access. To connect another space, create a
separate connection. The app never silently switches the selected space.

Try: “Find my selected television receipt and prepare an asset draft for review
in Teluva. Leave unknown warranty dates empty.” The chatbot can also submit
clearly named extracted text from documents the user has chosen to share with it.
It cannot browse arbitrary laptop or phone folders through this connector.

## Permissions and tools

| Permission | Available operations |
| --- | --- |
| `documents:read` | `search` and `fetch` for explicitly selected documents |
| `inbox:write` | `submit_import` to create pending review drafts |
| `inbox:write` | `import_original` to copy an explicitly authorised attachment and prepare a pending draft |
| Both | Prepare a draft by reading a selected original with Teluva AI |

`get_connection` reports the pinned space and permissions. No MCP tool applies,
overwrites or deletes asset records. `fetch` returns original plain text or
prepared text with its origin; AI transcriptions may be incomplete and require
checking against the original. It never returns protected download credentials.
New PDFs can be prepared using `submit_import` with `analyze: true`.

### Original attachments and provenance

`import_original` accepts ChatGPT's supported `openai/fileParams` file object:
`download_url`, `file_id`, optional `mime_type` and `file_name`. Original downloads
are limited to 12 MiB, recognised PDF/images or UTF-8 text, trusted host file
origins, public DNS pinned for TLS, bounded redirects and timeouts. No source
cookies, API keys or provider credentials are accepted or forwarded. Source page
URLs are metadata, never fetched. Temporary download credentials are not stored.
Compatible native hosts can submit exact original bytes up to 96 KiB in base64.

The caller names the source, provider/source ID and whether the bytes are an
original attachment or a native-document export. A SHA-256 verifies the copied
bytes. The source attribution is reported by the assistant, not independently
attested provider identity. Original files use protected storage with an uploader
owner; a business employee's new original is not silently shared. Importing a
file does not automatically add it to an existing read grant.

The request ID makes retries independent of an expiring download link. Identical
bytes from the same account and space reuse one protected original and one draft;
conflicting payloads cannot overwrite it. Files remain `Other` until document
categorisation is reviewed. Asset drafts link their source originals. No paid
Teluva AI is invoked by `import_original`.

### Account connection and personalisation

Public MCP initialization and tool descriptions contain no customer data and
are discoverable before sign-in. Every tool execution requires OAuth; tool
descriptors declare their OAuth scopes. Installing a private plugin is separate
from authorising a Teluva account. The AI connections screen reports the first
successful authenticated tool request instead of treating an unused grant as
proof that a conversation works. After a server update, refresh the host's tool
metadata when necessary.

`submit_import` also accepts a `preferences` proposal containing only supported
app language and theme. It must originate from explicit named request text,
never inferred document facts. The requesting adult alone can approve it in the
app. It persists in that account's private preferences and updates language and
appearance; another person's profiles, roles and shared settings are untouched.
A later manual device choice wins over an older suggestion on reload. Preference
drafts do not invoke paid document analysis.

The host chatbot uses the user's existing chatbot account. Teluva uses its
existing configured AI provider for explicit inbox analysis; no OpenAI or
Anthropic API key is requested. Text shared with a chatbot is subject to that
provider's own controls.

Manage and revoke connections in **AI connections**. Current membership, role
and original-file access are checked again on calls. Removing a member or
changing the membership record invalidates the old grant, including after a
later rejoin. Revocation stops future calls; it cannot recall information already
provided to another service.

## Implementation and operations

The server exposes OAuth discovery, protected-resource discovery, dynamic client
registration, PKCE S256 authorization-code exchange and rotating refresh tokens.
The canonical audience remains the primary Teluva origin even when a user signs
in through the legacy service URL. Redirects are limited to supported ChatGPT
and Claude callbacks or HTTP loopback clients. Secrets and bearer tokens are
stored hashed. Access tokens last 10 minutes; grants have a 30-day absolute
lifetime. Refresh-token reuse revokes the grant. Requests, consent, tools and
stored drafts have independent size and rate bounds.

Inbox and OAuth collections are server-only under the Firestore default-deny
rules. The inbox uses `families/{spaceId}/importInbox/{id}`. Staff listing needs a
collection-scope composite index on `importInbox`:

| Field | Order |
| --- | --- |
| `createdBy` | Ascending |
| `createdAt` | Descending |

That index was provisioned on the named production database `teluva-prod` for
this release. Preserve it when managing indexes. No partial index manifest is
introduced because this database already has other indexes.

Run `npm run test:connector-flow` for the local Firestore emulator's integrated
OAuth → MCP → inbox → review/apply flow. It uses synthetic actors, files and an
extractor stub; it does not contact a live AI service or write production data.
`npm test` includes the focused server, UI capability and scoped-request tests.

### Live acceptance evidence for v380

Both Cloud Run service names serve the same immutable v380 image. The release
passed type checking, colour checks, Firestore/Vault rules, 671 server tests,
the frontend test sequence and the production build. Public tool discovery
works before connection; unauthenticated tool execution returns 401.

The private Teluva plugin was updated in place to 0.2.0 and remains private.
The 0.2.1 branding update packages the exact existing Teluva 512px app icon
and references it as the logo and composer icon in both manifests. The private
host details page still shows its fallback lightbulb after loading 0.2.1; the
packaged branding was verified, but the host's displayed icon is unresolved.
The supported native host reports it installed and enabled. This chat's actual
Teluva tools successfully inspected the existing connection, searched its one
selected synthetic document and fetched its prepared text. This establishes a
working existing account connection; it does not establish first-time signup.

`scripts/verify-connector-customer.mjs --run-live` is an explicit operator test
for disposable accounts and spaces. It accepts only one or two deliberately
selected source fixtures. The tested `--backend-fixture` mode supplies consent
and review through a loopback disposable-identity adapter because production
password sign-in is disabled and the operator cannot sign custom Firebase
tokens. It leaves auth providers, IAM and customer credentials unchanged.
OAuth discovery, DCR, PKCE, token exchange and all MCP calls still use the
deployed service; consent/review in this mode are not production HTTP or browser
acceptance. Its report records that distinction.

Live verification covered a native Drive PDF export and one separately
authorised email attachment: byte-identical protected copies, SHA-256,
pending review, retries, content deduplication, synthetic durable apply,
self-approved preferences, space pinning, forbidden-space rejection,
authenticated-use status, revocation and reconnect. The real attachment
remained pending and all disposable copies, records, accounts and test grants
were removed. No paid Teluva AI was invoked. Detailed reports stay under the
ignored `output/verification/connector-v380/` directory and contain no source
contents, bearer tokens or temporary download URLs.

A second synthetic-only live run also verified original import and durable
asset/document application in a business space. Applying its records left the
family's drafts unchanged and its originals under the business storage prefix.
Content-derived IDs can match across separate spaces; identical IDs do not
constitute shared storage or shared access.

The normal consent page was also verified in the customer's existing signed-in
browser session, for both family and business selection. Saved-document reading
stays unchecked and import drafts are checked by default. That temporary request
was closed without approval; no grant was issued, its client/request metadata
was removed and the original family home was restored. Screenshots are kept in
the ignored verification directory. The existing chat connection still works
with its original one-document selection.

First-time Google sign-in and normal browser review/apply remain separate
interactive acceptance gates. Do not describe the fixture as proving those
steps or claim public marketplace availability. A selected synthetic original
opened in the real Vault viewer, but browser automation did not complete its
download event and reported a paused document response. The browser client also
blocked direct navigation to the selected synthetic original's content route.
Authenticated browser download remains unproven; these observations alone do
not establish an application defect.

The customer reported no new connection prompt because the existing connection
was already authenticated. Do not request a disconnect merely to repeat sign-in.
A previously unconnected Google test identity and an interactive customer
session are needed for the remaining first-time check. The separate browser
is open on Teluva's sign-in screen for the test account. The account owner
performs Google sign-in and accepts any terms personally; no password or
authorization code is entered into chat.

The connector does not yet include public marketplace publication, a native
desktop folder watcher, or a consumer Gemini-app extension. Native device-wide
discovery would require a separate companion and explicit folder permissions.

## Provider documentation

- [OpenAI: authenticated MCP servers](https://developers.openai.com/plugins/build/auth)
- [OpenAI: connect a custom server](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt)
- [Claude: remote MCP custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [MCP: Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

Provider documentation checked 3 November 2026.
