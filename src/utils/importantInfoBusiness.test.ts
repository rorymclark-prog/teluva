/**
 * v337: a 2026-08-29 audit of the business Compliance screen (ImportantInfo
 * in a business space) found four things left over from before this screen
 * had a business identity:
 *
 * 1. The "key numbers" empty state and placeholder hard-coded South African
 *    registration terms (CIPC/SARS/UIF/COIDA) for every business regardless
 *    of HubSettings.country — an Austrian or UK company was told to file
 *    numbers under the wrong country's scheme.
 * 2. The contacts form pointed at "Extended Birthdays" and "the family
 *    calendar" in a business space, where that view doesn't exist
 *    (HIDDEN_VIEWS_IN_BUSINESS, Dashboard.tsx) — a dangling reference.
 * 3. The provider "For" field said "blank = whole family" even when
 *    isBusinessSpace, alongside sibling copy in the same form (Name,
 *    Relation) that already branches correctly.
 * 4. Household vendors — reachable in BOTH space types, unfiltered, unlike
 *    ProvidersSection — never received isBusinessSpace at all, so an office's
 *    plumber/electrician list still read "Household vendors" and offered
 *    "the neighbour with the spare key".
 *
 * Same shape as businessCopy.test.ts next door: STRUCTURAL guards (a fix
 * that's really "wire the prop through" fails silently if a later edit drops
 * the wiring) plus TEXTUAL pins on the specific strings.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';

const root = join(import.meta.dirname ?? __dirname, '..', '..');
const info = readFileSync(join(root, 'src', 'components', 'ImportantInfo.tsx'), 'utf8');
const dashboard = readFileSync(join(root, 'src', 'components', 'Dashboard.tsx'), 'utf8');

let n = 0;
const check = (label: string, cond: boolean) => {
  n++;
  assert.ok(cond, label);
};

// --- 1. registration terms are country-branched, not SA-only ---------------
{
  check(
    'businessRegHint no longer branches on country — SA terms are back for every business',
    /function businessRegHint\(country\?: IdCountry\)[\s\S]{0,20}\{[\s\S]{0,400}case 'ZA':[\s\S]{0,400}case 'AT':/.test(info),
  );
  check(
    'the numbers empty-state no longer calls businessRegHint(country)',
    /No numbers yet — \$\{businessRegHint\(country\)\}/.test(info),
  );
  check(
    'the numbers form placeholder no longer calls businessRegHint(country)',
    /Label {2}\(e\.g\. \$\{businessRegHint\(country\)/.test(info),
  );
  check(
    'Dashboard stopped passing a country into ImportantInfo — every business now reads the SA default regardless of HubSettings.country',
    /<ImportantInfo[^/]*country=\{settings\.country \|\| 'AT'\}/.test(dashboard),
  );
  // Threading country through NumbersSection's own params and into
  // businessRegHint() is not enough — a call site that forgets to actually
  // PASS the prop silently falls through to the 'other' default, and both
  // tsc and the checks above stay green because country is optional. Caught
  // live on 2026-08-29: businessRegHint shipped correct, wired correct, and
  // the one invocation of <NumbersSection> simply never passed it.
  check(
    'ImportantInfo stopped passing country into <NumbersSection> — the component still declares the prop but nothing supplies it, so every business silently falls back to the generic default',
    /<NumbersSection\s+entries=\{numbers\}[\s\S]{0,400}country=\{country\}/.test(info),
  );
}

// --- 2. no dangling Extended Birthdays pointer in a business space ---------
{
  check(
    'the Extended Birthdays note in ContactForm is no longer gated on !isBusinessSpace — it points at a view that does not exist in a business space',
    /\{!isBusinessSpace && \(\s*<p className="text-\[11px\] text-ink-400">\s*Birthdays live in/.test(info),
  );
}

// --- 3. the provider "For" field branches on space type --------------------
{
  check(
    'the provider "For" placeholder no longer branches on isBusinessSpace — a business space would still read "blank = whole family"',
    /placeholder=\{isBusinessSpace \? 'For {2}\(optional — e\.g\. Katharina; blank = whole team\)' : 'For {2}\(optional — e\.g\. Mia; blank = whole family\)'\}/.test(info),
  );
}

// --- 4. household vendors re-labels itself in a business space -------------
{
  check(
    'VendorsSection no longer declares an isBusinessSpace prop',
    /function VendorsSection\(\{ entries, onAdd, onUpdate, onDelete, isBusinessSpace \}/.test(info),
  );
  check(
    'ImportantInfo stopped passing isBusinessSpace into VendorsSection — the section is reachable in business but never told so',
    /<VendorsSection\s+entries=\{vendors\}\s+isBusinessSpace=\{isBusinessSpace\}/.test(info),
  );
  check(
    'the vendors heading no longer branches — a business space would still read "Household vendors"',
    /\{isBusinessSpace \? 'Vendors' : 'Household vendors'\}/.test(info),
  );
  check(
    'the vendors empty-state no longer branches — a business space would still be offered "the neighbour with the spare key"',
    /No vendors yet — your plumber, electrician, cleaner, or IT support\./.test(info),
  );
}

console.log(`importantInfoBusiness: ${n} checks passed`);
