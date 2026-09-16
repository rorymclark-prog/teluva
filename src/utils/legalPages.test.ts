import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderLegalPage } from './legalPages';

const privacy = renderLegalPage('privacy');
const terms = renderLegalPage('terms');

for (const [name, html] of [['privacy', privacy], ['terms', terms]] as const) {
  assert.match(html, /^<!doctype html><html lang="en">/, `${name} is a complete HTML document`);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/, `${name} is phone-readable`);
  assert.match(html, /Last updated: 28 July 2026/, `${name} carries the legal document's accurate update date`);
  assert.ok(!/<script\b/i.test(html), `${name} must not contain inline or external scripts`);
  assert.ok(html.length > 1_000, `${name} must contain the policy body rather than an SPA shell`);
}

assert.match(privacy, /This policy explains what personal data Teluva collects/);
assert.match(privacy, /Who is responsible for your data/);
assert.match(terms, /Teluva is a private tool for organising your family/);
assert.match(terms, /The AI assistant/);

const server = readFileSync('server.js', 'utf8');
const catchAll = server.indexOf("app.get('*'");
for (const route of ['/privacy', '/terms']) {
  const routeIndex = server.indexOf(`app.get('${route}'`);
  assert.ok(routeIndex >= 0, `${route} must have an explicit Express route`);
  assert.ok(routeIndex < catchAll, `${route} must be registered before the SPA catch-all`);
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
assert.match(packageJson.scripts.build, /render-legal-pages/, 'the production build must render the legal pages');

console.log('legalPages.test.ts: all assertions passed');
