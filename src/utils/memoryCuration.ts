import JSZip from 'jszip';
import type { FileOperationScope } from './fileOperationScope';
import type { MemoryProposal } from './importInboxClient';
export const MEMORY_HIGHLIGHT_LIMIT = 5;
export function memoryEvidenceContext(source: string, quote: string): string {
  const index = source.indexOf(quote);
  return index < 0 ? quote : source.slice(Math.max(0, index - 240), Math.min(source.length, index + quote.length + 240));
}
const TEXT_LIMIT = 5 * 1024 * 1024, CONTEXT_LIMIT = 19000;
const significant = /\b(birthday|born|wedding|married|anniversary|graduat\w*|first (?:step|word|day|time)|said|poem|remember|moved|new home|holiday|vacation|travelled|traveled|visited|broke (?:his |her |my |the )?arm|fractur\w*|cast|proud|achiev\w*|funny|beach|adventure)\b/i;
/** Local preselection is bounded and explicitly partial, never a claim to
 * understand a full chat or an authority to save a memory. */
export function curateSourceWindows(source: string): { text: string; partial: boolean; sourceChars: number } {
  if (source.length <= CONTEXT_LIMIT) return { text: source, partial: false, sourceChars: source.length };
  const lines = source.split(/\r?\n/), blocks: string[] = []; let used = 0, until = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!significant.test(lines[i]) || i <= until) continue;
    const start = Math.max(0, i - 2), end = Math.min(lines.length, i + 4);
    const block = lines.slice(start, end).join('\n').slice(0, 2200);
    if (used + block.length + 4 > CONTEXT_LIMIT) break;
    blocks.push(block); used += block.length + 4; until = end - 1;
  }
  return { text: blocks.join('\n\n'), partial: true, sourceChars: source.length };
}
export async function readMemoryExport(file: File, scope: FileOperationScope): Promise<string> {
  scope.check();
  if (/\.txt$/i.test(file.name)) {
    if (file.size > TEXT_LIMIT) throw new Error('Choose a chat text export smaller than 5 MB, or a smaller date range.');
    return scope.step(() => file.text());
  }
  if (!/\.zip$/i.test(file.name) || file.size > 30 * 1024 * 1024) throw new Error('Choose a WhatsApp ZIP smaller than 30 MB or a TXT export smaller than 5 MB.');
  const zip = await scope.step(async () => JSZip.loadAsync(await file.arrayBuffer()));
  const entries = Object.values(zip.files);
  if (entries.length > 2500) throw new Error('That export has too many files. Export the chat without media; choose one cover photo separately.');
  const chats = entries.filter(entry => !entry.dir && /(?:^|\/)(?:_chat|WhatsApp Chat[^/]*)\.txt$/i.test(entry.name));
  if (chats.length !== 1) throw new Error('Choose an export containing exactly one chat text file, or import its TXT file directly.');
  const chunks: Uint8Array[] = []; let count = 0;
  const bytes = await scope.step(() => new Promise<Uint8Array>((resolve, reject) => {
    const entry = chats[0] as typeof chats[0] & { internalStream: (type: 'uint8array') => JSZip.JSZipStreamHelper<Uint8Array> };
    const stream = entry.internalStream('uint8array');
    stream.on('data', chunk => { count += chunk.length; if (count > TEXT_LIMIT || !scope.isCurrent()) { stream.pause(); reject(new Error('The chat text is too large or the selected account/space changed.')); } else chunks.push(chunk); });
    stream.on('error', reject); stream.on('end', () => { const result = new Uint8Array(count); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } resolve(result); }); stream.resume();
  }));
  return new TextDecoder().decode(bytes);
}
export function memoryFromRow(row: Record<string, unknown>): MemoryProposal | null {
  if (typeof row.title !== 'string' || !row.title.trim() || typeof row.date !== 'string' || typeof row.sourceText !== 'string' || !row.sourceText.trim()) return null;
  const category = ['memory', 'milestone', 'holiday', 'home', 'school', 'medical', 'other'].includes(String(row.category)) ? row.category as MemoryProposal['category'] : 'memory';
  return { title: row.title.slice(0, 180), date: row.date, category, evidenceQuote: row.sourceText.slice(0, 1500),
    ...(row.datePrecision === 'month' || row.datePrecision === 'year' ? { datePrecision: row.datePrecision } : {}),
    ...(typeof row.note === 'string' ? { note: row.note } : {}), memberIds: Array.isArray(row.memberIds) ? row.memberIds.filter((id): id is string => typeof id === 'string') : [] };
}
