import { jsPDF } from 'jspdf';
import { SummaryBlock, SummaryDoc } from './exportPack';

// The written summary as a PDF a person can open.
//
// WHY BOTH THIS AND THE MARKDOWN
// ------------------------------
// "Is a Markdown file for all the data a good way, or should we do a formatted
// PDF? Or both?" — both, because the two readers are different people.
//
// Markdown is perfect for the machine end of the ask: another AI, a text
// editor, a script. It is also what a paediatrician's receptionist opens to a
// screenful of asterisks and pipe characters, on a device with nothing
// installed that renders it. A PDF is the exact opposite — every phone and
// desktop on earth opens one, it prints, and it looks like a document rather
// than like source code.
//
// So both go in the folder. They are rendered from the SAME structure (see
// SummaryDoc in exportPack.ts), never one from the other: generating the PDF
// by parsing our own Markdown would make one renderer's output the other's
// input, and every escaping quirk would become a layout bug.
//
// A KNOWN LIMIT, STATED RATHER THAN HIDDEN
// ----------------------------------------
// This uses jsPDF's built-in Helvetica, which covers Latin-1 — so German
// umlauts, French accents and Afrikaans are fine, and Polish, Turkish, Czech
// or Greek characters are not. Embedding a full Unicode face costs roughly a
// megabyte in the bundle. The Markdown file in the same folder is UTF-8 and
// always correct, so nothing is ever LOST to this; it only affects how the PDF
// draws those glyphs. Revisit if a tester's own name renders wrong.

const PAGE = { w: 595.28, h: 841.89 };   // A4 in points
const M = { top: 54, bottom: 54, left: 48, right: 48 };
const CONTENT_W = PAGE.w - M.left - M.right;

const INK = [31, 30, 28] as const;
const MUTED = [122, 118, 110] as const;
const RULE = [223, 218, 208] as const;
const HEAD_FILL = [244, 241, 234] as const;

/**
 * Hand out the page width across a table's columns.
 *
 * `floors[c]` is the width of that column's widest UNBREAKABLE word, and is
 * the whole point of this function: a column narrower than its own longest
 * word does not wrap, it breaks mid-word with no hyphen to explain itself.
 * Rendering a real sample is what exposed that — the header "Status" came out
 * as "Sta / tus", every value "open" as "ope / n", and a date as
 * "2026-06 / -15".
 *
 * `wants[c]` is what the column would take if nothing else needed room. Every
 * column is given its floor first; whatever is left over is shared out in
 * proportion to how much each still wants, which is what gives a Notes column
 * the space and leaves a Date column exactly as wide as a date.
 *
 * Exported, and separated from all the drawing, purely so this rule can be
 * asserted rather than eyeballed.
 */
export function distributeColumnWidths(
  floors: readonly number[], wants: readonly number[], total: number,
): number[] {
  const floorTotal = floors.reduce((a, b) => a + b, 0);
  if (floorTotal <= 0) return floors.map(() => total / Math.max(1, floors.length));
  if (floorTotal >= total) {
    // Genuinely does not fit even at minimum — a table of long unbroken
    // strings. Shrink proportionally and accept the mid-word break rather than
    // running off the edge of the page, where the text would be lost entirely.
    return floors.map((w) => (w / floorTotal) * total);
  }
  const slack = total - floorTotal;
  const appetite = wants.map((w, c) => Math.max(0, w - floors[c]));
  const appetiteTotal = appetite.reduce((a, b) => a + b, 0);
  // Everything already fits comfortably: share the leftover evenly so the table
  // spans the page instead of hugging the left margin.
  if (appetiteTotal === 0) return floors.map((w) => w + slack / floors.length);
  return floors.map((w, c) => w + (appetite[c] / appetiteTotal) * slack);
}

export interface SummaryPdf {
  blob: Blob;
  /** Bytes, so the export screen's size estimate can include it. */
  size: number;
}

/**
 * Render the summary. Returns a Blob rather than triggering a download, so the
 * caller decides whether it is shared, zipped, or both.
 */
export function renderSummaryPdf(doc: SummaryDoc): SummaryPdf {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  let y = M.top;

  const setFont = (size: number, style: 'normal' | 'bold' | 'italic' = 'normal',
    colour: readonly number[] = INK) => {
    pdf.setFont('helvetica', style);
    pdf.setFontSize(size);
    pdf.setTextColor(colour[0], colour[1], colour[2]);
  };

  /** Start a new page if `needed` points would run past the bottom margin. */
  const room = (needed: number) => {
    if (y + needed <= PAGE.h - M.bottom) return;
    pdf.addPage();
    y = M.top;
  };

  /** Wrapped paragraph. Returns nothing; advances y. */
  const paragraph = (text: string, size: number, style: 'normal' | 'bold' | 'italic',
    colour: readonly number[], lead = 1.35, x = M.left, width = CONTENT_W) => {
    setFont(size, style, colour);
    const lines = pdf.splitTextToSize(text, width) as string[];
    for (const line of lines) {
      room(size * lead);
      pdf.text(line, x, y + size * 0.85);
      y += size * lead;
    }
  };

  const rule = (gap = 8) => {
    room(gap + 2);
    pdf.setDrawColor(RULE[0], RULE[1], RULE[2]);
    pdf.setLineWidth(0.6);
    pdf.line(M.left, y + gap / 2, PAGE.w - M.right, y + gap / 2);
    y += gap;
  };

  // --- title block ---------------------------------------------------------
  paragraph(doc.title, 20, 'bold', INK, 1.25);
  y += 4;
  for (const line of doc.intro) paragraph(line, 9.5, 'normal', MUTED, 1.4);
  y += 8;

  // The disclaimer gets a tinted band so it is not mistaken for a finding.
  {
    setFont(8.5, 'italic', MUTED);
    const lines = pdf.splitTextToSize(doc.disclaimer, CONTENT_W - 20) as string[];
    const boxH = lines.length * 8.5 * 1.35 + 14;
    room(boxH);
    pdf.setFillColor(HEAD_FILL[0], HEAD_FILL[1], HEAD_FILL[2]);
    pdf.roundedRect(M.left, y, CONTENT_W, boxH, 5, 5, 'F');
    let ly = y + 11;
    for (const line of lines) {
      pdf.text(line, M.left + 10, ly);
      ly += 8.5 * 1.35;
    }
    y += boxH + 16;
  }

  // --- blocks --------------------------------------------------------------
  const facts = (rows: [string, string][]) => {
    // A fixed label column, because a ragged one makes a list of nine facts
    // read as nine unrelated sentences.
    const labelW = Math.min(150, CONTENT_W * 0.34);
    const valueW = CONTENT_W - labelW - 10;
    for (const [k, v] of rows) {
      setFont(9.5, 'bold', INK);
      const kl = pdf.splitTextToSize(k, labelW) as string[];
      setFont(9.5, 'normal', INK);
      const vl = pdf.splitTextToSize(v, valueW) as string[];
      const h = Math.max(kl.length, vl.length) * 9.5 * 1.35 + 2;
      room(h);
      setFont(9.5, 'bold', INK);
      kl.forEach((l, i) => pdf.text(l, M.left, y + 8 + i * 9.5 * 1.35));
      setFont(9.5, 'normal', INK);
      vl.forEach((l, i) => pdf.text(l, M.left + labelW + 10, y + 8 + i * 9.5 * 1.35));
      y += h;
    }
    y += 4;
  };

  const table = (headers: string[], rows: string[][]) => {
    // Column widths.
    //
    // The first version of this measured columns in CHARACTERS and clamped
    // each one to between 6 and 40, then normalised. Rendering a real sample
    // showed exactly what that does to a narrow column: the header "Status"
    // came out as "Sta / tus", every value "open" as "ope / n", and a date as
    // "2026-06 / -15". A column narrower than its own longest WORD does not
    // wrap, it hyphenates without the hyphen.
    //
    // So each column gets a floor: the width of its widest unbreakable word,
    // measured in real points at the real font. Whatever is left over after
    // every column can hold its longest word is then handed out in proportion
    // to how much each column would still LIKE — which is what gives Notes the
    // room and leaves Date exactly as wide as a date.
    const PAD = 10;
    const widthOf = (text: string, bold: boolean) => {
      setFont(8.5, bold ? 'bold' : 'normal');
      return pdf.getTextWidth(text || '—');
    };
    const measure = (c: number, longestWordOnly: boolean) => {
      const cells = rows.map((r) => r[c] || '—');
      const pick = (t: string) => (longestWordOnly
        ? String(t).split(/\s+/).reduce((w, s) => Math.max(w, widthOf(s, false)), 0)
        : widthOf(String(t), false));
      const head = longestWordOnly
        ? headers[c].split(/\s+/).reduce((w, s) => Math.max(w, widthOf(s, true)), 0)
        : widthOf(headers[c], true);
      return Math.max(head, ...cells.map(pick)) + PAD;
    };

    // One pathological value (a long URL, a German compound noun) must not be
    // allowed to claim half the table on its own.
    const floors = headers.map((_, c) => Math.min(measure(c, true), CONTENT_W * 0.4));
    const wants = headers.map((_, c) => Math.max(measure(c, false), floors[c]));

    const widths = distributeColumnWidths(floors, wants, CONTENT_W);

    const cellLines = (text: string, w: number) =>
      pdf.splitTextToSize(text || '—', w - 10) as string[];

    const drawHeader = () => {
      setFont(8.5, 'bold', INK);
      const hl = headers.map((h, c) => cellLines(h, widths[c]));
      const h = Math.max(...hl.map((l) => l.length)) * 8.5 * 1.3 + 9;
      room(h + 18); // a header with no room for even one row is just noise
      pdf.setFillColor(HEAD_FILL[0], HEAD_FILL[1], HEAD_FILL[2]);
      pdf.rect(M.left, y, CONTENT_W, h, 'F');
      let x = M.left;
      hl.forEach((lines, c) => {
        lines.forEach((l, i) => pdf.text(l, x + 5, y + 10 + i * 8.5 * 1.3));
        x += widths[c];
      });
      y += h;
    };

    drawHeader();
    setFont(8.5, 'normal', INK);
    for (const r of rows) {
      const cl = headers.map((_, c) => cellLines(r[c] || '', widths[c]));
      const h = Math.max(...cl.map((l) => l.length)) * 8.5 * 1.3 + 8;
      if (y + h > PAGE.h - M.bottom) {
        pdf.addPage();
        y = M.top;
        // Repeat the header: a table continuing onto page 3 with no column
        // names is a wall of unlabelled dates.
        drawHeader();
        setFont(8.5, 'normal', INK);
      }
      let x = M.left;
      cl.forEach((lines, c) => {
        lines.forEach((l, i) => pdf.text(l, x + 5, y + 9 + i * 8.5 * 1.3));
        x += widths[c];
      });
      pdf.setDrawColor(RULE[0], RULE[1], RULE[2]);
      pdf.setLineWidth(0.4);
      pdf.line(M.left, y + h, PAGE.w - M.right, y + h);
      y += h;
    }
    y += 10;
  };

  const block = (b: SummaryBlock) => {
    if (b.type === 'note') { paragraph(b.text, 9, 'italic', MUTED, 1.4); y += 4; return; }
    if (b.type === 'facts') { facts(b.rows); return; }
    table(b.headers, b.rows);
  };

  for (const sec of doc.sections) {
    if (sec.level === 2) {
      // A person's name in a folder covering several people. Given a page of
      // its own when it would otherwise land at the very bottom.
      room(70);
      y += 10;
      paragraph(sec.heading, 15, 'bold', INK, 1.3);
      rule(6);
      y += 4;
    } else {
      room(46);
      y += 6;
      paragraph(sec.heading, 11.5, 'bold', INK, 1.3);
      y += 3;
    }
    for (const b of sec.blocks) block(b);
  }

  if (doc.footnote) {
    rule(12);
    paragraph(doc.footnote, 9, 'italic', MUTED, 1.4);
  }

  // --- page numbers, added last so the total is known ----------------------
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    setFont(8, 'normal', MUTED);
    pdf.text(`${doc.title}`, M.left, PAGE.h - 24, { maxWidth: CONTENT_W - 70 });
    pdf.text(`${i} / ${pages}`, PAGE.w - M.right, PAGE.h - 24, { align: 'right' });
  }

  const blob = pdf.output('blob') as Blob;
  return { blob, size: blob.size };
}
