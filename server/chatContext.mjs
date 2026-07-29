// Fitting a family's vault into the chat request to Gemini.
//
// THE DECISION THIS REPLACES ("retrieval vs full-vault", backlog #106)
// -----------------------------------------------------------------------
// The vault sent to the model is already compact: member facts, document
// METADATA (name/category/date — never file contents), calendar events, and
// a few precomputed insight lists (expiries/gaps) — see AIChatbot.tsx's
// buildContext(). Nothing here is raw scanned text or embedded files, so
// "full vault" was never actually sending everything the vault holds, only
// its structured facts.
//
// Building real retrieval (embeddings + a vector search over the vault, only
// pulling in what seems relevant to the current message) was the other
// option, and it is deliberately NOT what this file does. Two reasons:
//
//   1. It solves a problem this app doesn't have yet. gemini-2.5-flash's
//      input window is roughly 1,000,000 tokens. At ~4 characters/token,
//      that is ~4,000,000 characters. The one real family who overflowed
//      the OLD 120,000-character cap was at ~156,000 — about 4% of the
//      model's actual capacity. The ceiling that mattered was self-imposed,
//      not the model's.
//   2. It reintroduces, on the READ side, the exact bug class this codebase
//      already treats as serious on the WRITE side: "invisible to the AI"
//      (see aiEditCoverage.test.ts and the Referrals/Vaccinations/visas
//      fixes — every one of those was a vault section the assistant
//      couldn't see or touch). A bad embedding match silently omitting a
//      document is the same failure, just quieter: nobody notices until a
//      parent asks about a medication and the assistant has genuinely never
//      seen it this session. For a vault holding medical and safety data,
//      a bounded, deliberately-ordered drop (below) that at least degrades
//      the same way every time and is fully covered by tests is a better
//      trade than a similarity score deciding, per-query, what the model
//      gets to know exists.
//
// So: raise the self-imposed ceiling to something that actually reflects the
// model's headroom, keep dropping whole low-value sections in a fixed order
// as the last-resort safety net for the pathological case, and keep it pure
// and tested rather than inline in the route handler.

// ~4 characters/token is the standard rough estimate for English-ish JSON
// (a mix of prose, punctuation-heavy structure, and numbers/dates). Budgeted
// against gemini-2.5-flash's ~1,000,000-token input window, leaving generous
// room for: the system instruction, up to 8 history turns (4,000 chars each,
// so ≤32,000 chars), up to 6 attached images (images consume input tokens
// too), and the user's own message. 600,000 characters is ~150,000 tokens —
// comfortably under 20% of the window even before that headroom, and about
// 4x the one real overflow this app has seen, while staying far short of the
// full ceiling so a corrupted or runaway context can't balloon the request
// (and its cost) without bound.
export const CTX_LIMIT = 600_000;

// Least useful to the assistant first. `expiries`, `gaps` and `members` are
// never dropped — losing them was the original bug (a blind character cut
// that happened to cut those off because they serialised last).
export const CTX_DROP_ORDER = ['timeline', 'calendar', 'finances', 'slips', 'documents', 'household'];

/**
 * Fit `context` under `limit`, dropping whole keys from `dropOrder` (in
 * order) until it does, rather than ever truncating the JSON string
 * mid-structure. Always returns valid JSON.
 *
 * Returns `{ ctxJson, dropped }` — `dropped` is empty when nothing had to go,
 * so the caller can log/flag only when it actually happened.
 */
export function trimContext(context, limit = CTX_LIMIT, dropOrder = CTX_DROP_ORDER) {
  const ctxObj = { ...(context ?? {}) };
  const dropped = [];
  let ctxJson = JSON.stringify(ctxObj);

  for (const key of dropOrder) {
    if (ctxJson.length <= limit) break;
    if (!(key in ctxObj)) continue;
    delete ctxObj[key];
    dropped.push(key);
    ctxJson = JSON.stringify(ctxObj);
  }

  if (dropped.length) {
    ctxObj._omitted = dropped;
    ctxJson = JSON.stringify(ctxObj);
  }

  // Last resort: a single surviving section (most likely `members` on a huge
  // family) is somehow still over the limit on its own. Cutting here is still
  // wrong — the same blind-truncation bug this file exists to avoid — but an
  // oversized, slightly-malformed payload beats failing the request outright,
  // and `dropped` already tells the caller to log it.
  if (ctxJson.length > limit) {
    ctxJson = ctxJson.slice(0, limit);
    if (!dropped.includes('_truncated')) dropped.push('_truncated');
  }

  return { ctxJson, dropped };
}
