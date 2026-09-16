/**
 * Teluva Gmail Bridge
 *
 * WHY THIS IS AN APPS SCRIPT AND NOT A FEATURE INSIDE TELUVA.
 * Every Gmail scope that can read a message body or an attachment
 * (gmail.readonly, gmail.metadata, gmail.modify) is a Google RESTRICTED
 * scope. A published web app asking for one must pass an annual third-party
 * CASA security assessment. Teluva deliberately avoids that whole regime —
 * it is why it asks for drive.file rather than drive.readonly.
 *
 * A script you author and run inside YOUR OWN Google account is not subject
 * to any of it: no verification, no assessment, no unverified-app warning,
 * no 100-test-user cap, and no seven-day refresh-token expiry. The trade is
 * that it lives here rather than in the app, and each person who wants it
 * installs their own copy.
 *
 * WHAT IT DOES. Every 15 minutes it looks for recent mail with attachments,
 * keeps the images and PDFs, and posts them to Teluva, which files them in
 * the family Document Vault exactly as an upload would. It then labels the
 * thread Teluva/Filed so you can see what it took.
 *
 * WHAT IT NEVER DOES. It does not read, store, transmit or log message
 * BODIES. Only the subject line, the sender, and the attachments themselves
 * leave this script — the subject and sender solely so the filed document
 * can say where it came from.
 *
 * SETUP (three Script Properties; see README.md for the clasp commands):
 *   TELUVA_URL    https://teluva-x3k4bua7pq-nw.a.run.app
 *   TELUVA_TOKEN  the bridge token from Teluva → Documents → Connect Gmail
 *   TELUVA_QUERY  optional; overrides the default Gmail search below
 */

// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------

/* The routine window. Deliberately SHORT. The trigger runs four times an
 * hour, so a wide window means re-examining hundreds of the same threads all
 * day for nothing. Anything older is a job for backfillTeluva() below, which
 * you run by hand once. */
var DEFAULT_QUERY = 'has:attachment newer_than:7d';

/* Applied to every thread this script files from, so the mailbox itself shows
 * you what has been taken. It is NOT how re-filing is prevented — see
 * wasSeen_() — because a label is thread-level in Apps Script, and excluding
 * labelled threads would silently skip a NEW attachment arriving as a reply
 * on a thread already filed once. */
var FILED_LABEL = 'Teluva/Filed';

/* Gmail hands back every inline image in a signature block as an attachment.
 * Teluva only files photographs and PDFs anyway; everything else is dropped
 * here so it never crosses the network. */
var ALLOWED_TYPES = ['image/', 'application/pdf'];

/* Below this, it is a logo or a tracking pixel, not a document. Above the
 * upper bound, the vault would reject it on arrival — and base64 inflates a
 * payload by a third, so a genuinely large file also risks the UrlFetchApp
 * request limit. Both bounds are here so a bad attachment costs nothing. */
var MIN_ATTACHMENT_BYTES = 8 * 1024;
var MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/* How many message ids to remember so the same attachment is not uploaded
 * every quarter of an hour. Script Properties caps a single value at 9KB and
 * a Gmail message id is ~16 characters, so this sits well inside it. The
 * server de-duplicates independently — this is only here to save bandwidth,
 * which is why it can afford to forget. */
var SEEN_LIMIT = 250;
var SEEN_KEY = 'TELUVA_SEEN_IDS';

// ---------------------------------------------------------------------------
// MAIN — the trigger entry point
// ---------------------------------------------------------------------------

function syncTeluva() {
  return runSync_(getQuery_());
}

/**
 * One-off catch-up over a wider window. Run this by hand after connecting,
 * to sweep in what was already sitting in the mailbox. Pass any Gmail search
 * string, e.g. backfillTeluva('has:attachment newer_than:2y from:versicherung').
 */
function backfillTeluva(query) {
  return runSync_(query || 'has:attachment newer_than:1y');
}

function runSync_(query) {
  var cfg = readConfig_();
  var label = getOrCreateLabel_(FILED_LABEL);
  var seen = readSeen_();
  var stats = { threads: 0, examined: 0, sent: 0, filed: 0, skipped: 0, failed: 0 };

  var start = 0;
  while (true) {
    var threads = GmailApp.search(query, start, 25);
    if (threads.length === 0) break;

    for (var t = 0; t < threads.length; t++) {
      stats.threads++;
      var messages = threads[t].getMessages();
      var tookFromThread = false;

      for (var m = 0; m < messages.length; m++) {
        var message = messages[m];
        var id = message.getId();
        if (seen.indexOf(id) !== -1) { stats.skipped++; continue; }
        stats.examined++;

        var payload = buildPayload_(message);
        if (!payload) { rememberSeen_(seen, id); continue; }

        stats.sent += payload.attachments.length;
        var result = postToTeluva_(cfg, payload);

        if (result.ok) {
          stats.filed += result.filed;
          tookFromThread = tookFromThread || result.filed > 0;
          /* Only a message Teluva has actually answered for is marked seen. A
           * network failure must leave it unmarked so the next run retries it
           * — the whole point of a background sync is that a blip costs
           * nothing. */
          rememberSeen_(seen, id);
        } else {
          stats.failed++;
          Logger.log('Teluva bridge: delivery failed (' + result.status + ') — will retry next run');
          /* A rejected TOKEN will not fix itself, and retrying every fifteen
           * minutes forever is how you get rate-limited. Stop the run. */
          if (result.status === 401 || result.status === 403) {
            writeSeen_(seen);
            throw new Error('Teluva rejected the bridge token (' + result.status + '). Reconnect Gmail in Teluva and update TELUVA_TOKEN.');
          }
        }
      }

      if (tookFromThread) threads[t].addLabel(label);
    }

    start += threads.length;
  }

  writeSeen_(seen);
  Logger.log('Teluva bridge: ' + JSON.stringify(stats));
  return stats;
}

// ---------------------------------------------------------------------------
// BUILDING ONE DELIVERY
// ---------------------------------------------------------------------------

/**
 * Everything this script is willing to send about one message, or null when
 * there is nothing worth sending. Note what is absent: getPlainBody() and
 * getBody() are never called anywhere in this file.
 */
function buildPayload_(message) {
  var attachments = message.getAttachments({ includeInlineImages: false, includeAttachments: true });
  if (!attachments || attachments.length === 0) return null;

  var kept = [];
  for (var i = 0; i < attachments.length; i++) {
    var att = attachments[i];
    var type = (att.getContentType() || '').toLowerCase().split(';')[0];
    if (!isAllowedType_(type)) continue;
    var size = att.getSize();
    if (size < MIN_ATTACHMENT_BYTES || size > MAX_ATTACHMENT_BYTES) continue;
    kept.push({
      filename: att.getName(),
      mimeType: type,
      dataBase64: Utilities.base64Encode(att.getBytes()),
    });
  }
  if (kept.length === 0) return null;

  return {
    gmailMessageId: message.getId(),
    subject: message.getSubject(),
    from: message.getFrom(),
    attachments: kept,
  };
}

function isAllowedType_(type) {
  for (var i = 0; i < ALLOWED_TYPES.length; i++) {
    var allowed = ALLOWED_TYPES[i];
    /* A prefix ending in "/" is a whole family (image/); anything else must
     * match exactly. "image" without the slash would also admit a content
     * type like "image-not-really/x". */
    if (allowed.charAt(allowed.length - 1) === '/') {
      if (type.indexOf(allowed) === 0) return true;
    } else if (type === allowed) {
      return true;
    }
  }
  return false;
}

function postToTeluva_(cfg, payload) {
  var response = UrlFetchApp.fetch(cfg.url + '/api/gmail-bridge/deliver', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + cfg.token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) return { ok: false, status: status, filed: 0 };
  var body = {};
  try { body = JSON.parse(response.getContentText()); } catch (e) { body = {}; }
  return { ok: true, status: status, filed: body.filed || 0 };
}

// ---------------------------------------------------------------------------
// CONFIGURATION AND STATE
// ---------------------------------------------------------------------------

function readConfig_() {
  var props = PropertiesService.getScriptProperties();
  var url = (props.getProperty('TELUVA_URL') || '').replace(/\/+$/, '');
  var token = props.getProperty('TELUVA_TOKEN') || '';
  if (!url || !token) {
    throw new Error('Teluva bridge is not configured. Set TELUVA_URL and TELUVA_TOKEN in Script Properties (see README.md).');
  }
  return { url: url, token: token };
}

function getQuery_() {
  return PropertiesService.getScriptProperties().getProperty('TELUVA_QUERY') || DEFAULT_QUERY;
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function readSeen_() {
  var raw = PropertiesService.getScriptProperties().getProperty(SEEN_KEY);
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Object.prototype.toString.call(parsed) === '[object Array]' ? parsed : [];
  } catch (e) {
    return [];
  }
}

function rememberSeen_(seen, id) {
  seen.push(id);
  /* Oldest out first. A forgotten id is harmless: the server refuses the
   * duplicate, so the only cost is one wasted upload. */
  while (seen.length > SEEN_LIMIT) seen.shift();
}

function writeSeen_(seen) {
  PropertiesService.getScriptProperties().setProperty(SEEN_KEY, JSON.stringify(seen));
}

// ---------------------------------------------------------------------------
// INSTALLATION
// ---------------------------------------------------------------------------

/**
 * Installs the 15-minute trigger, replacing any it already made. Run once
 * after setting the Script Properties.
 */
function installTeluvaTrigger() {
  removeTeluvaTriggers();
  ScriptApp.newTrigger('syncTeluva').timeBased().everyMinutes(15).create();
  Logger.log('Teluva bridge: trigger installed (every 15 minutes).');
}

function removeTeluvaTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncTeluva') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  Logger.log('Teluva bridge: removed ' + removed + ' trigger(s).');
}

/**
 * Proves the token and URL work without touching the mailbox at all. Run this
 * first — a 401 here is a wrong token, and finding that out costs one request
 * instead of a whole failed sync.
 */
function testTeluvaConnection() {
  var cfg = readConfig_();
  var response = UrlFetchApp.fetch(cfg.url + '/api/gmail-bridge/deliver', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + cfg.token },
    payload: JSON.stringify({ gmailMessageId: 'connection-test', attachments: [] }),
    muteHttpExceptions: true,
  });
  Logger.log('Teluva bridge: ' + response.getResponseCode() + ' ' + response.getContentText());
  return response.getResponseCode();
}

/**
 * Set one Script Property from the terminal, so configuring this never means
 * opening the Apps Script editor:
 *   clasp run setProperty --params '["TELUVA_TOKEN","<token>"]'
 */
function setProperty(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
  Logger.log('Teluva bridge: set ' + key + '.');
  return 'ok';
}

/**
 * What is configured, with the token REDACTED — the whole point of a bridge
 * token is that it exists in exactly two places, and a log file is not one
 * of them.
 */
function showConfig() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TELUVA_TOKEN') || '';
  var out = {
    TELUVA_URL: props.getProperty('TELUVA_URL') || '(not set)',
    TELUVA_TOKEN: token ? (token.slice(0, 4) + '…' + token.slice(-4) + ' (' + token.length + ' chars)') : '(not set)',
    TELUVA_QUERY: props.getProperty('TELUVA_QUERY') || '(default: ' + DEFAULT_QUERY + ')',
    seenIds: readSeen_().length,
    triggers: ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'syncTeluva'; }).length,
  };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
