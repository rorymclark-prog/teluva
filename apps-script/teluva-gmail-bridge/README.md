# Teluva Gmail Bridge

Scans your own Gmail for attachments and files the images and PDFs into your
Teluva Document Vault. Runs every 15 minutes.

## Why it lives here and not in the app

Every Gmail scope that can read an attachment is a Google **restricted**
scope, and a published web app that asks for one has to pass an annual
third-party CASA security assessment. Teluva avoids that regime entirely —
it is the same reason it asks for `drive.file` rather than `drive.readonly`.

A script you author and run in your **own** account is outside all of it: no
verification, no assessment, no unverified-app warning screen, no 100-user
cap, and no seven-day refresh-token expiry. The cost is that each person who
wants this installs their own copy.

## What crosses the network

Attachments, the subject line, and the sender — the last two only so the
filed document can say where it came from. **Message bodies are never read.**
`getPlainBody()` and `getBody()` do not appear anywhere in `Code.gs`.

## Setup — all from the terminal

You need `clasp` logged in (`clasp login`).

```bash
cd ~/Claude/projects/family-info-organizer/apps-script/teluva-gmail-bridge

# 1. Create the Apps Script project (writes .clasp.json)
clasp create --type standalone --title "Teluva Gmail Bridge" --rootDir .

# 2. Push the code
clasp push -f

# 3. Set the three properties. Get the token from Teluva:
#    Documents → Connect Gmail → Create token. It is shown ONCE.
clasp run setProperty --params '["TELUVA_URL","https://teluva-x3k4bua7pq-nw.a.run.app"]'
clasp run setProperty --params '["TELUVA_TOKEN","<paste the token>"]'

# 4. Prove the token works before touching the mailbox (expect 200)
clasp run testTeluvaConnection

# 5. Install the 15-minute trigger
clasp run installTeluvaTrigger

# 6. Optional one-off sweep of what is already sitting in the mailbox
clasp run backfillTeluva
```

`clasp run` needs the project's Cloud Platform project set and the Apps Script
API enabled (<https://script.google.com/home/usersettings>). If `clasp run` is
not available, the same three properties can be set with
`clasp push` + a one-line `setProperty` call, or from the editor's Project
Settings → Script Properties.

## Turning it off

```bash
clasp run removeTeluvaTriggers
```

and revoke the token in Teluva → Documents → Connect Gmail → Disconnect. Either
one alone stops the filing; do both so the token cannot be reused.

## Tuning what it looks at

`TELUVA_QUERY` overrides the default search (`has:attachment newer_than:7d`).
Any Gmail search string works, so you can narrow it hard:

```
has:attachment newer_than:7d (from:versicherung OR from:wienenergie OR subject:Rechnung)
```

Keep the window short. The trigger runs four times an hour; a wide window
means re-walking the same threads all day. Use `backfillTeluva('<query>')` for
one-off history sweeps instead.
