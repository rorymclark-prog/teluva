// What the assistant can actually be handed, and what to say when it can't.
//
// The chat composer used to accept exactly two things — an image or a PDF —
// and only through the Attach button or a pasted screenshot. Anything else
// produced NOTHING: no attachment, no error, no explanation. A person dragging
// a document onto the panel, or copying one and pressing paste, got a composer
// that sat there as if they had not done anything at all. "I can't paste a doc
// into chat" is what that looks like from the outside, and silence is the
// worst possible answer because it gives you no idea whether to try again,
// try differently, or give up.
//
// So every file now gets a verdict, and an unusable one gets a sentence naming
// the way out. The formats below are what Gemini can actually read inline;
// the rejections are the formats a family plausibly has lying around, each
// with the specific fix rather than a generic "unsupported file type".

export type AttachmentPlan =
  /** Send as-is after the usual downscale. */
  | { kind: 'image'; mimeType: string }
  | { kind: 'pdf'; mimeType: 'application/pdf' }
  /** Any text-shaped file. Normalised to text/plain deliberately — see below. */
  | { kind: 'text'; mimeType: 'text/plain' }
  /** Unusable. `reason` is a finished sentence for the user, not a code. */
  | { kind: 'reject'; reason: string };

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff']);
const TEXT_EXT = new Set(['txt', 'text', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'xml', 'html', 'htm', 'rtf', 'vcf', 'ics', 'yml', 'yaml']);

// Formats worth naming individually, because the fix differs and "convert it"
// is useless advice if you don't know what to convert it to.
const KNOWN_BAD: Array<{ ext: string[]; reason: string }> = [
  { ext: ['doc', 'docx'], reason: 'Word documents can’t be read directly — open it and save as PDF (File → Save as → PDF), then attach that.' },
  { ext: ['pages'], reason: 'Pages documents can’t be read directly — open it and export as PDF (File → Export To → PDF), then attach that.' },
  { ext: ['xls', 'xlsx', 'numbers'], reason: 'Spreadsheets can’t be read directly — export it as PDF or CSV and attach that instead.' },
  { ext: ['ppt', 'pptx', 'key'], reason: 'Presentations can’t be read directly — export it as PDF and attach that instead.' },
  { ext: ['zip', 'rar', '7z', 'tar', 'gz'], reason: 'That’s a compressed folder — unzip it first and attach the document inside.' },
  { ext: ['mov', 'mp4', 'avi', 'mkv', 'm4v', 'webm'], reason: 'Videos can’t be read — if there’s something to file in it, take a screenshot of that moment and send the picture.' },
  { ext: ['mp3', 'm4a', 'wav', 'aac', 'ogg'], reason: 'Audio files can’t be read — type or dictate what it says instead (the microphone button records straight into the message).' },
];

const GENERIC_REJECT = 'That file type can’t be read. PDFs, photos and plain-text files all work — saving it as a PDF is usually the quickest way.';

/** Lowercase extension without the dot, or '' when the name carries none. */
export function extensionOf(name: string): string {
  const base = (name || '').split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase().trim() : '';
}

/**
 * Decide what to do with one file, from its name and the browser-reported MIME
 * type. Pure and total: an empty name and an empty type are ordinary inputs
 * (a clipboard file often has both), not an error case.
 *
 * MIME is trusted first and the extension is the fallback, because the two
 * disagree constantly in the wild — macOS hands over a `.md` file with an
 * empty type, some browsers call a `.csv` `application/vnd.ms-excel`, and a
 * file dragged out of an email may arrive as `application/octet-stream` with
 * nothing but its name to go on.
 */
export function planAttachment(name: string, type: string): AttachmentPlan {
  const mime = (type || '').toLowerCase().split(';')[0].trim();
  const ext = extensionOf(name);

  // Reject the known-bad formats on EXTENSION FIRST. A .docx is a zip of XML,
  // so a type-led check can talk itself into "that's basically text" and hand
  // the model a page of markup — from which it will cheerfully extract
  // confident nonsense. Better to refuse with the one-line fix.
  for (const bad of KNOWN_BAD) {
    if (bad.ext.includes(ext)) return { kind: 'reject', reason: bad.reason };
  }

  if (mime === 'application/pdf' || (!mime && ext === 'pdf')) {
    return { kind: 'pdf', mimeType: 'application/pdf' };
  }
  if (mime.startsWith('image/') || (!mime && IMAGE_EXT.has(ext))) {
    // Keep the reported type: HEIC from an iPhone is readable as-is, and the
    // caller downscales (and re-encodes to JPEG) only when the browser's
    // canvas can decode it.
    return { kind: 'image', mimeType: mime || `image/${ext === 'jpg' ? 'jpeg' : ext}` };
  }

  // Everything text-shaped is sent as text/plain rather than its true type.
  // The bytes are text either way, and the exact label is a trap: browsers say
  // `text/markdown` where the model expects `text/md`, `application/rtf` where
  // it expects `text/rtf`, and an unrecognised label is rejected outright at
  // the far end. text/plain is understood everywhere and loses nothing that
  // matters for reading a document.
  const textish = mime.startsWith('text/')
    || ['application/json', 'application/xml', 'application/rtf', 'application/x-yaml', 'application/yaml'].includes(mime)
    || ((!mime || mime === 'application/octet-stream') && TEXT_EXT.has(ext));
  if (textish) return { kind: 'text', mimeType: 'text/plain' };

  return { kind: 'reject', reason: GENERIC_REJECT };
}

/**
 * Does this pasted text look like a file PATH rather than something to say?
 *
 * Copying a file in Finder (or Explorer) does NOT put the file on the
 * clipboard in a form a web page can read — only its location. Pasting into
 * the message box therefore types "/Users/rory/Desktop/consent.pdf" where a
 * sentence should be, which reads as "nothing happened" and is the single most
 * likely thing behind "I can't paste a doc into chat". Recognising it is what
 * lets the composer explain the difference instead of shrugging.
 *
 * Deliberately narrow: one token, no spaces, absolute, with a file extension.
 * A sentence that merely mentions a path is a sentence, and gets pasted.
 */
export function looksLikeFilePath(text: string): boolean {
  const t = (text || '').trim();
  if (!t || /\s/.test(t)) return false;
  return /^(file:\/\/|\/(Users|Volumes|home|mnt|tmp)\/|[A-Za-z]:\\)\S*\.[A-Za-z0-9]{2,5}$/.test(t);
}

// The first few bytes of the formats worth recognising. Order matters only in
// that every signature here is unambiguous at offset 0.
const MAGIC: Array<{ ext: string; mime: string; sig: number[] }> = [
  { ext: 'pdf', mime: 'application/pdf', sig: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { ext: 'png', mime: 'image/png', sig: [0x89, 0x50, 0x4e, 0x47] },
  { ext: 'jpg', mime: 'image/jpeg', sig: [0xff, 0xd8, 0xff] },
  { ext: 'gif', mime: 'image/gif', sig: [0x47, 0x49, 0x46, 0x38] },
];

/**
 * What a file actually IS, read from its first bytes rather than its label.
 *
 * Only for files that arrive with no type and no name — a paste can hand over
 * both blank. The old code guessed `.png` in that case, which is the one guess
 * with teeth: a PDF named `pasted-1.png` is planned as an image, pushed through
 * a `<canvas>` that cannot decode it, and sent to the model as a broken
 * picture. Nobody sees an error; the answer is just wrong. Four bytes settle it.
 *
 * Returns null when the bytes match nothing known — the caller keeps its own
 * fallback rather than having one invented here.
 */
export async function sniffFileType(file: Blob): Promise<{ ext: string; mime: string } | null> {
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  } catch {
    return null;
  }
  for (const { ext, mime, sig } of MAGIC) {
    if (sig.every((b, i) => head[i] === b)) return { ext, mime };
  }
  // WebP is RIFF????WEBP — the signature straddles a 4-byte length field.
  const starts = (at: number, ...bytes: number[]) => bytes.every((b, i) => head[at + i] === b);
  if (starts(0, 0x52, 0x49, 0x46, 0x46) && starts(8, 0x57, 0x45, 0x42, 0x50)) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

/** What the Attach button's file picker offers. Mirrors planAttachment's accepts. */
export const ATTACH_ACCEPT = 'image/*,application/pdf,text/plain,text/csv,text/markdown,text/html,application/json,.txt,.md,.csv,.log,.rtf,.vcf,.ics';

/**
 * One error line for a batch of rejected files. Names the file when there is
 * one — "that file" is no help when four went in at once and three worked.
 */
export function rejectionMessage(rejected: Array<{ name: string; reason: string }>): string {
  if (!rejected.length) return '';
  if (rejected.length === 1) {
    const { name, reason } = rejected[0];
    return name ? `${name} — ${reason}` : reason;
  }
  // Several files, one shared reason: say it once.
  const reasons = new Set(rejected.map(r => r.reason));
  const names = rejected.map(r => r.name).filter(Boolean).join(', ');
  if (reasons.size === 1) return `${names ? names + ' — ' : ''}${rejected[0].reason}`;
  return `Couldn’t use ${rejected.length} of those files: ${rejected.map(r => `${r.name || 'one file'} (${r.reason})`).join(' ')}`;
}
