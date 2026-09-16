import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderLegalPage, type PublicLegalPage } from '../src/utils/legalPages';

const outputDirectory = path.resolve(process.cwd(), 'dist');
const pages: PublicLegalPage[] = ['privacy', 'terms'];

mkdirSync(outputDirectory, { recursive: true });
for (const page of pages) {
  writeFileSync(path.join(outputDirectory, `${page}.html`), renderLegalPage(page), 'utf8');
}

console.log(`render-legal-pages: wrote ${pages.map((page) => `dist/${page}.html`).join(', ')}`);
