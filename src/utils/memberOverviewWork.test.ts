/**
 * v337: a business colleague's work summary — current role and the
 * soonest-expiring certificate — belongs on the profile's landing tab
 * (MemberOverview), not buried one click away on the CV tab. See
 * src/components/MemberOverview.tsx's currentRoleLabel/
 * nextExpiringQualification and src/utils/qualificationExpiry.ts.
 *
 * Three ways this could quietly break:
 *
 * 1. STRUCTURAL — the work block ships ungated and a family member's profile
 *    (which has no cv data at all, and no business concept of a "role") grows
 *    an empty or nonsensical card.
 * 2. DRIFT — MemberOverview grows its own "expires soon" threshold instead of
 *    sharing MemberCV's, and the glance card and the CV tab start disagreeing
 *    about whether the same certificate is expiring soon.
 * 3. SILENT — nothing wires isBusinessSpace through from Dashboard, so the
 *    gate above is permanently false and the whole feature is dead code.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';
import { qualificationExpiryStatus } from './qualificationExpiry';

const root = join(import.meta.dirname ?? __dirname, '..', '..');
const src = (rel: string) => readFileSync(join(root, 'src', rel), 'utf8');

const overview = src('components/MemberOverview.tsx');
const memberCv = src('components/MemberCV.tsx');
const dashboard = src('components/Dashboard.tsx');

let n = 0;
const check = (label: string, cond: boolean) => {
  n++;
  assert.ok(cond, label);
};

// --- 1. structural: the work rows are gated on isBusinessSpace -------------
{
  const gated = /if \(isBusinessSpace\) \{[\s\S]{0,600}currentRoleLabel[\s\S]{0,400}nextExpiringQualification/.exec(overview);
  check('the work summary (role + certificate) is not gated behind isBusinessSpace — a family profile would show it', !!gated);
}

// --- 2. isBusinessSpace is actually threaded in, not a dead default --------
{
  check(
    'MemberOverview no longer accepts an isBusinessSpace prop',
    /isBusinessSpace\?\s*:\s*boolean/.test(overview),
  );
  check(
    'Dashboard does not pass isBusinessSpace down to MemberOverview — the gate above is permanently false',
    /<MemberOverview[\s\S]{0,400}isBusinessSpace=\{isBusinessSpace\}/.test(dashboard),
  );
}

// --- 3. no second "expires soon" threshold has crept in ---------------------
{
  // MemberCV's own ExpiryChip must delegate to the shared helper rather than
  // recomputing months-until-expiry itself — that recomputation IS the bug
  // this shared module exists to prevent.
  check(
    'MemberCV.ExpiryChip computes its own expiry window instead of calling qualificationExpiryStatus — it can now disagree with the overview card',
    /qualificationExpiryStatus\(expiryDate\)/.test(memberCv) && !/diffDays \/ 30\.4375/.test(memberCv),
  );
  // nearestExpiry() above already computes months-until with its own
  // 30.4375-day-month constant for passports/documents — a different feature
  // that predates this one and is out of scope here. Scope the check to
  // nextExpiringQualification's own body so that pre-existing code doesn't
  // false-positive this guard.
  const qualFn = /function nextExpiringQualification[\s\S]*?\n\}/.exec(overview)?.[0] || '';
  check('nextExpiringQualification is missing entirely', !!qualFn);
  check(
    'nextExpiringQualification computes its own expiry window instead of calling the shared helper',
    /qualificationExpiryStatus\(/.test(qualFn) && !/30\.4375/.test(qualFn),
  );
}

// --- 4. the shared threshold behaves as both callers expect -----------------
{
  const day = 86400000;
  const now = Date.UTC(2026, 7, 29);
  check('a certificate that lapsed yesterday is expired', qualificationExpiryStatus(new Date(now - day).toISOString(), now) === 'expired');
  check('a certificate expiring in 10 days is soon', qualificationExpiryStatus(new Date(now + 10 * day).toISOString(), now) === 'soon');
  check('a certificate expiring in 2 years is ok', qualificationExpiryStatus(new Date(now + 730 * day).toISOString(), now) === 'ok');
}

// --- 5. a member with nothing to show renders nothing -----------------------
{
  // currentRoleLabel/nextExpiringQualification must both return null on an
  // empty member, and the call sites must only push a row when non-null —
  // otherwise a colleague with no cv data at all grows a blank "Role" row.
  check(
    'currentRoleLabel does not return null on a member with no role data — an empty card can render',
    /if \(!title && !employer\) return null;/.test(overview),
  );
  check(
    'nextExpiringQualification does not return null on a member with no dated qualifications',
    /if \(!dated\.length\) return null;/.test(overview),
  );
  check(
    'the Role row is pushed unconditionally instead of gated on currentRoleLabel returning a value',
    /if \(role\) rows\.push\(\{ icon: Briefcase, label: 'Role'/.test(overview),
  );
  check(
    'the Certificate row is pushed unconditionally instead of gated on nextExpiringQualification returning a value',
    /if \(qual\) \{[\s\S]{0,200}rows\.push\(\{[\s\S]{0,100}label: 'Certificate'/.test(overview),
  );
}

// --- v339: the filed CV is labelled where it lands ------------------------
//
// MemberCV files the CV as a FamilyDocument with category 'Other' — there is
// no 'CV' value in FamilyDocument's category union to file it under. So it
// also appears in the ordinary Documents list, chipped "Other", identical to
// any uncategorised scan. Badging it there beats hiding it: the delete and
// share controls for that file live on the Documents screen and nowhere else,
// so hiding the row would strand them.
{
  const docs = src('components/MemberDocuments.tsx');
  check(
    'the filed CV is no longer badged in the Documents list — it renders as an ordinary "Other" document, indistinguishable from an uncategorised scan',
    /doc\.id === member\.cv\?\.fileDocumentId && \([\s\S]{0,200}Filed CV/.test(docs),
  );
  check(
    'the filed CV is being FILTERED OUT of the Documents list rather than badged — that strands its delete and share controls, which exist only on this screen',
    !/visibleDocs[\s\S]{0,120}fileDocumentId/.test(docs)
      && !/allDocs[\s\S]{0,120}fileDocumentId/.test(docs),
  );
}

console.log(`memberOverviewWork: ${n} assertions passed`);
