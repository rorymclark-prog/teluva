# AI import inbox and chatbot connections

The family and business sections share a persistent **AI import inbox** and an
OAuth-protected remote MCP connector. The inbox keeps suggestions separate from
saved asset records. An administrator reviews and applies each suggestion.

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
can authorize text-only draft submission. To connect another space, create a
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
| Both | Prepare a draft by reading a selected original with Teluva AI |

`get_connection` reports the pinned space and permissions. No MCP tool applies,
overwrites or deletes asset records. `fetch` returns original plain text or
prepared text with its origin; AI transcriptions may be incomplete and require
checking against the original. It never returns protected download credentials.
New PDFs can be prepared using `submit_import` with `analyze: true`.

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

The connector does not yet include public marketplace publication, a native
desktop folder watcher, or a consumer Gemini-app extension. Native device-wide
discovery would require a separate companion and explicit folder permissions.

## Provider documentation

- [OpenAI: authenticated MCP servers](https://developers.openai.com/plugins/build/auth)
- [OpenAI: connect a custom server](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt)
- [Claude: remote MCP custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [MCP: Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

Provider documentation checked 1 November 2026.
