import { planAttachment, extensionOf, rejectionMessage, ATTACH_ACCEPT, looksLikeFilePath, sniffFileType } from './attachments';

let passed = 0;
const fails: string[] = [];
const check = (name: string, cond: boolean) => { cond ? passed++ : fails.push(name); };

// --- extensionOf ------------------------------------------------------------
check('plain extension', extensionOf('consent.pdf') === 'pdf');
check('uppercase folds', extensionOf('SCAN.PDF') === 'pdf');
check('multiple dots take the last', extensionOf('ben.consent.v2.pdf') === 'pdf');
check('no extension', extensionOf('Scanned Document') === '');
check('dotfile is not an extension', extensionOf('.gitignore') === '');
check('path is stripped', extensionOf('/Users/rory/Desktop/a.png') === 'png');
check('empty name is safe', extensionOf('') === '');

// --- the things that must work ---------------------------------------------
{
  const p = planAttachment('consent.pdf', 'application/pdf');
  check('pdf by mime', p.kind === 'pdf');
}
{
  // Dragged out of an email client: no useful type, only the name.
  const p = planAttachment('consent.pdf', '');
  check('pdf by extension when the type is missing', p.kind === 'pdf');
}
{
  const p = planAttachment('IMG_4821.HEIC', 'image/heic');
  check('heic is an image', p.kind === 'image' && p.mimeType === 'image/heic');
}
{
  const p = planAttachment('photo.jpg', '');
  check('jpg with no type becomes image/jpeg', p.kind === 'image' && p.mimeType === 'image/jpeg');
}
{
  const p = planAttachment('clipboard', 'image/png');
  check('a nameless clipboard image still works', p.kind === 'image');
}
{
  const p = planAttachment('flights.csv', 'text/csv');
  check('csv is readable', p.kind === 'text');
  check('text types are normalised to text/plain', p.kind === 'text' && p.mimeType === 'text/plain');
}
{
  // macOS commonly reports .md as no type at all.
  const p = planAttachment('notes.md', '');
  check('markdown with no type is readable', p.kind === 'text');
}
{
  const p = planAttachment('booking.txt', 'application/octet-stream');
  check('octet-stream falls back to the extension', p.kind === 'text');
}
{
  const p = planAttachment('trip.ics', 'text/calendar');
  check('a calendar file is text', p.kind === 'text');
}

// --- the things that must be refused, with a usable reason ------------------
{
  const p = planAttachment('Consent letter.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  check('docx is refused', p.kind === 'reject');
  check('the docx reason says to save as PDF', p.kind === 'reject' && /PDF/.test(p.reason));
}
{
  // The trap this ordering exists for: a .docx IS a zip, and some browsers
  // report it as one. Extension-first keeps the specific Word advice.
  const p = planAttachment('Consent letter.docx', 'application/zip');
  check('docx reported as zip still gets the Word advice', p.kind === 'reject' && /Word/.test(p.reason));
}
{
  const p = planAttachment('Tickets.pages', '');
  check('pages is refused with Export To advice', p.kind === 'reject' && /Export To/.test(p.reason));
}
{
  const p = planAttachment('budget.xlsx', '');
  check('spreadsheets are refused', p.kind === 'reject' && /CSV/.test(p.reason));
}
{
  const p = planAttachment('docs.zip', 'application/zip');
  check('zip is refused with unzip advice', p.kind === 'reject' && /unzip/i.test(p.reason));
}
{
  const p = planAttachment('IMG_2210.MOV', 'video/quicktime');
  check('video is refused and suggests a screenshot', p.kind === 'reject' && /screenshot/.test(p.reason));
}
{
  const p = planAttachment('voicenote.m4a', 'audio/mp4');
  check('audio is refused and points at the microphone', p.kind === 'reject' && /microphone/.test(p.reason));
}
{
  const p = planAttachment('app.dmg', 'application/x-apple-diskimage');
  check('an unknown binary is refused generically', p.kind === 'reject' && /PDF/.test(p.reason));
}
{
  const p = planAttachment('', '');
  check('a nameless typeless file is refused, not crashed on', p.kind === 'reject');
}

// --- rejectionMessage -------------------------------------------------------
check('no rejections is an empty string', rejectionMessage([]) === '');
{
  const m = rejectionMessage([{ name: 'a.docx', reason: 'Word documents can’t be read.' }]);
  check('a single rejection names the file', m.startsWith('a.docx — '));
}
{
  const m = rejectionMessage([
    { name: 'a.docx', reason: 'Word documents can’t be read.' },
    { name: 'b.docx', reason: 'Word documents can’t be read.' },
  ]);
  check('one shared reason is stated once', (m.match(/Word documents/g) || []).length === 1);
  check('both names appear', m.includes('a.docx') && m.includes('b.docx'));
}
{
  const m = rejectionMessage([
    { name: 'a.docx', reason: 'Word documents can’t be read.' },
    { name: 'b.zip', reason: 'That’s a compressed folder.' },
  ]);
  check('mixed reasons are all reported', m.includes('Word documents') && m.includes('compressed folder'));
}

// --- the picker offers what the planner accepts ------------------------------
check('accept covers pdf', ATTACH_ACCEPT.includes('application/pdf'));
check('accept covers images', ATTACH_ACCEPT.includes('image/*'));
check('accept covers plain text', ATTACH_ACCEPT.includes('text/plain'));
check('accept offers bare extensions for types browsers mislabel', ATTACH_ACCEPT.includes('.md') && ATTACH_ACCEPT.includes('.csv'));

// --- looksLikeFilePath ------------------------------------------------------
check('a mac path is recognised', looksLikeFilePath('/Users/rory/Desktop/consent.pdf'));
check('a file:// url is recognised', looksLikeFilePath('file:///Users/rory/a.pdf'));
check('a windows path is recognised', looksLikeFilePath('C:\\Users\\rory\\a.pdf'));
check('a volumes path is recognised', looksLikeFilePath('/Volumes/USB/scan.jpg'));
check('a sentence mentioning a path is NOT a path', !looksLikeFilePath('the file is at /Users/rory/a.pdf'));
check('a relative name is not a path', !looksLikeFilePath('consent.pdf'));
check('a path with no extension is not matched', !looksLikeFilePath('/Users/rory/Desktop'));
check('a website url is not a file path', !looksLikeFilePath('https://example.com/a.pdf'));
check('ordinary prose is not a path', !looksLikeFilePath('Ben flies on the 22nd'));
check('empty text is not a path', !looksLikeFilePath(''));

// --- sniffFileType ----------------------------------------------------------
// A pasted file can arrive with no name AND no type. The old code called that
// a PNG, so a PDF went to the model as a broken picture with no error anywhere.
const blob = (...bytes: number[]) => new Blob([new Uint8Array(bytes)]);
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function sniffChecks() {
  const pdf = await sniffFileType(blob(...PDF));
  check('a %PDF header is read as a pdf', pdf?.mime === 'application/pdf' && pdf?.ext === 'pdf');
  const png = await sniffFileType(blob(...PNG));
  check('a PNG header is read as a png', png?.mime === 'image/png');
  const jpg = await sniffFileType(blob(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0));
  check('a JPEG header is read as a jpeg', jpg?.mime === 'image/jpeg');
  const webp = await sniffFileType(blob(0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9, 0x57, 0x45, 0x42, 0x50));
  check('webp is matched across its length field', webp?.mime === 'image/webp');
  // RIFF that is NOT webp (a .wav) must not be claimed as an image.
  const wav = await sniffFileType(blob(0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9, 0x57, 0x41, 0x56, 0x45));
  check('a RIFF wav is not mistaken for webp', wav === null);
  check('unknown bytes return null rather than a guess', (await sniffFileType(blob(1, 2, 3, 4, 5, 6, 7, 8))) === null);
  check('a file too short to match returns null', (await sniffFileType(blob(0x25, 0x50))) === null);
  check('an empty file returns null', (await sniffFileType(blob())) === null);
  // The whole point: the sniffed type must survive planAttachment as a PDF.
  check('a sniffed pdf plans as a pdf', planAttachment('pasted-1.pdf', 'application/pdf').kind === 'pdf');
  // And the bug it replaces: the old fallback named it .png, which planned as
  // an image and sent it through a canvas that cannot decode a PDF.
  check('the old png guess would have planned as an image', planAttachment('pasted-1.png', '').kind === 'image');
}

sniffChecks().then(() => {
  if (fails.length) {
    console.error(`attachments: ${fails.length} FAILED of ${passed + fails.length}`);
    for (const f of fails) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`attachments: ${passed} assertions passed`);
});
