# Inbound email → vault filing

`POST /api/inbound-mail` lets someone forward an email (with attachments) to
a per-family address and have the attachments filed straight into that
family's Document Vault. **The code is complete and tested, but the route
answers `503 Inbound mail is not configured on this deployment` right now
and does nothing else.** Nothing works until every step below is done —
there is no partial/soft-launch state.

## Why it's dormant

The app currently runs only on `*.run.app` (Cloud Run's own domain). Google
does not let you add an MX record to a shared `*.run.app` hostname, so this
route has nothing to receive mail at. It needs a real domain you control.

## What switches it on

### 1. Get a domain (or a subdomain of one you already own)

Any domain works — it does not need to be the domain the app is served
from. A dedicated subdomain, e.g. `mail.teluva.app` or
`inbound.yourdomain.com`, is the cleanest choice: it keeps this one MX
record from interfering with any other mail already flowing through your
main domain.

### 2. Point MX at SendGrid's Inbound Parse

At your DNS provider, on the subdomain you chose, add:

| Type | Host                          | Value                | Priority |
|------|-------------------------------|-----------------------|----------|
| MX   | `mail` (or whatever subdomain) | `mx.sendgrid.net`     | 10       |

Wait for DNS to propagate (can take up to a few hours) before the next step
— SendGrid verifies the MX record before it will accept the webhook setup.

### 3. Create the SendGrid Inbound Parse webhook

In SendGrid: **Settings → Inbound Parse → Add Host & URL**.

- **Domain**: the subdomain from step 1 (e.g. `mail.teluva.app`)
- **Destination URL**: the Cloud Run service URL plus this route, with the
  secret from step 4 as a query parameter:

  ```
  https://<your-cloud-run-url>/api/inbound-mail?secret=<INBOUND_MAIL_SECRET>
  ```

  The secret in the URL is the entire authentication mechanism for this
  webhook — there is no other credential SendGrid can present. Treat that
  URL itself as a secret (don't paste it anywhere public).
- Leave **"POST the raw, full MIME message"** UNCHECKED — this route parses
  SendGrid's normal parsed multipart fields (`to`, `from`, `subject`,
  `attachments`, `attachment-info`, `attachment1..N`), not a raw MIME
  stream.
- Check **"Send Grid check activity"**/spam checks per your own preference;
  this route does not depend on either.

### 4. Set the two Cloud Run environment variables

```
INBOUND_MAIL_SECRET=<a long random string — e.g. `openssl rand -hex 32`>
INBOUND_MAIL_DOMAIN=<the subdomain from step 1, e.g. mail.teluva.app>
```

Set both via Secret Manager / `gcloud run services update --set-env-vars`
(or the Cloud Run console), matching however `VAPID_PUBLIC_KEY` and the
other secrets already in `run-service.yaml` are provisioned. **Both** must
be set — the route checks for both and 503s if either is missing (see
`server.js`, `INBOUND_MAIL_READY`).

`INBOUND_MAIL_SECRET` must exactly match the `secret=` query parameter used
in the webhook URL in step 3. If you rotate it, update both places together
— rotating only the env var locks the existing webhook out silently (every
inbound message gets a `403` and SendGrid starts retrying/bouncing).

## What happens once it's live

Each family's inbound address is `<token>@<INBOUND_MAIL_DOMAIN>`, where
`<token>` is deterministically derived from the family's id and
`INBOUND_MAIL_SECRET` (see `server/inboundMail.mjs`, `familyAddressToken`) —
nothing is stored to make this work; the address is recomputed both to show
it in the UI (`GET /api/inbound-mail/address`, an authenticated,
signed-in-member-only endpoint — a family's inbound address is a write
capability into its own vault and must never be derivable for a family you
are not in) and to resolve an inbound message back to a family. That
endpoint also answers `{ enabled: false }` while the feature is dormant, so
the client has one shape to read either way.

A message is only filed if:

- the URL secret matches (or the request never gets past this point), and
- the recipient's local-part token resolves to a real family, and
- the sender's email address is one of that family's own members' emails.

Anything else — including a message from someone genuinely not a member of
that family — is silently dropped (logged, but answered `200` so SendGrid
doesn't retry it back at the sender). Only image (`image/*`) and PDF
(`application/pdf`) attachments are filed; inline signature/footer images
are skipped automatically. Filed documents show up in the shared Document
Vault with `uploadedBy: "Emailed in by <sender>"`.
