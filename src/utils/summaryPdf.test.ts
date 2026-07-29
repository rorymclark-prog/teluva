import assert from 'node:assert/strict';
import { SummaryDoc, renderSummaryMarkdown } from './exportPack';
import { renderSummaryPdf, distributeColumnWidths } from './summaryPdf';

const doc = (over: Partial<SummaryDoc> = {}): SummaryDoc => ({
  title: 'Sophie Clark — medical records',
  intro: ['Prepared 2026-07-29 from Clark – Home Tribe using Teluva.'],
  disclaimer: 'This is a copy of records as they were entered.',
  sections: [],
  ...over,
});

// --- no column is ever narrower than its own longest word ------------------
{
  // The defect this guards against was found by rendering a sample PDF and
  // LOOKING at it: columns were measured in characters and clamped to a
  // minimum of six, so the header "Status" rendered as "Sta / tus", every
  // value "open" as "ope / n", and a date as "2026-06 / -15". Every assertion
  // about the document model passed the whole time — the model was fine.
  const floors = [52, 48, 40, 90, 34, 60];   // widest unbreakable word per column
  const wants = [52, 60, 120, 110, 34, 420]; // Notes wants far more than the rest
  const widths = distributeColumnWidths(floors, wants, 499);

  widths.forEach((w, c) => assert.ok(
    w >= floors[c] - 0.001,
    `column ${c} came out at ${w.toFixed(1)}, under its longest word at ${floors[c]}`,
  ));
  assert.ok(Math.abs(widths.reduce((a, b) => a + b, 0) - 499) < 0.001, 'the row fills the page exactly');
  // The column with the appetite gets the slack; the ones already satisfied do not.
  assert.ok(widths[5] > widths[3], 'Notes ends up the widest');
  assert.equal(widths[0], floors[0], 'a column wanting no more than its floor keeps its floor');
  assert.equal(widths[4], floors[4], 'and so does Status');
}

// --- when nothing fits, it shrinks rather than running off the page --------
{
  const floors = [400, 400, 400];
  const widths = distributeColumnWidths(floors, floors, 499);
  assert.ok(Math.abs(widths.reduce((a, b) => a + b, 0) - 499) < 0.001, 'still exactly one page wide');
  assert.ok(widths.every((w) => w < 400), 'every column gave something up');
}

// --- when everything fits, the table still spans the page ------------------
{
  const floors = [40, 40];
  const widths = distributeColumnWidths(floors, floors, 500);
  assert.deepEqual(widths, [250, 250], 'the slack is shared, not left as a margin');
}

// --- degenerate input -------------------------------------------------------
{
  assert.deepEqual(distributeColumnWidths([], [], 500), [], 'no columns, no widths');
  assert.deepEqual(distributeColumnWidths([0, 0], [0, 0], 500), [250, 250], 'zero floors do not divide by zero');
}

// --- it produces a real PDF ------------------------------------------------
{
  const { blob, size } = renderSummaryPdf(doc({
    sections: [{
      heading: 'Medical record',
      level: 3,
      blocks: [{ type: 'facts', rows: [['Blood group', 'A+'], ['Allergies', 'Penicillin']] }],
    }],
  }));
  assert.equal(blob.type, 'application/pdf');
  assert.ok(size > 1000, 'a PDF with content in it is not a stub');
}

// --- the awkward inputs it must survive ------------------------------------
{
  assert.doesNotThrow(() => renderSummaryPdf(doc()), 'a summary with no sections');
  assert.doesNotThrow(() => renderSummaryPdf(doc({
    sections: [{ heading: 'Empty', level: 3, blocks: [{ type: 'table', headers: ['A', 'B'], rows: [] }] }],
  })), 'a table with no rows');
  assert.doesNotThrow(() => renderSummaryPdf(doc({
    sections: [{
      heading: 'Long', level: 3,
      blocks: [{
        type: 'table',
        headers: ['Ref', 'Note'],
        rows: [['A'.repeat(300), 'Donaudampfschifffahrtsgesellschaftskapitaen']],
      }],
    }],
  })), 'one pathological word must not take the table off the page');
  assert.doesNotThrow(() => renderSummaryPdf(doc({
    sections: [{ heading: 'Multi', level: 3, blocks: [{ type: 'facts', rows: [['Notes', 'line one\nline two']] }] }],
  })), 'a value containing a newline');
  assert.doesNotThrow(() => renderSummaryPdf(doc({
    sections: Array.from({ length: 40 }, (_, i) => ({
      heading: `Section ${i}`, level: 3 as const,
      blocks: [{
        type: 'table' as const, headers: ['Date', 'What'],
        rows: Array.from({ length: 30 }, (_, j) => [`2026-01-${(j % 28) + 1}`, `Entry ${j}`]),
      }],
    })),
  })), 'enough content to span many pages');
}

// --- both renderers read the same document ---------------------------------
{
  // The point of the shared SummaryDoc: neither renderer is derived from the
  // other's output, so a value present in one is present in the other.
  const d = doc({
    sections: [{
      heading: 'Vaccinations', level: 3,
      blocks: [{ type: 'table', headers: ['Vaccination', 'Date'], rows: [['MMR', '2019-04-01']] }],
    }],
  });
  const md = renderSummaryMarkdown(d);
  assert.match(md, /MMR/);
  assert.match(md, /### Vaccinations/);
  assert.match(md, /^# Sophie Clark — medical records$/m);
  assert.ok(renderSummaryPdf(d).size > 1000);
}

// --- a pipe in a value cannot break the markdown table ---------------------
{
  const md = renderSummaryMarkdown(doc({
    sections: [{
      heading: 'Notes', level: 3,
      blocks: [{ type: 'table', headers: ['What', 'Detail'], rows: [['Dose', '5mg | twice daily']] }],
    }],
  }));
  const row = md.split('\n').find((l) => l.includes('Dose'))!;
  // Count UNESCAPED pipes only — the escaped one is a character in the value,
  // not a column boundary, which is the whole point.
  const separators = (row.match(/(?<!\\)\|/g) || []).length;
  assert.equal(separators, 3, 'two columns means three separators, whatever the values contain');
  assert.match(row, /5mg \\\| twice daily/);
}

console.log('summaryPdf.test.ts: all assertions passed');
