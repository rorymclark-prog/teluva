import type { FamilyDocument } from '../types';
import { fileContentUrl, filePathFromReference } from './fileReferences';

/** Describe the reference/provenance we actually have, not a sync guarantee. */
export function documentStorageDescription(doc: FamilyDocument): { label: string; detail: string } {
  const source = doc.fileData;
  if (!source || source === 'PLACEHOLDER') return { label: 'Placeholder', detail: 'No original file is available in this view.' };
  if (filePathFromReference(source)) return {
    label: 'Protected Vault file',
    detail: doc.connectorSource?.representation === 'export' ? 'Imported document export. Access is checked when you open the file.'
      : doc.connectorSource?.representation === 'original' ? 'Imported original attachment. Access is checked when you open the file.'
      : 'Access is checked when you open the file.',
  };
  if (source.startsWith('data:')) return { label: 'Embedded file', detail: 'File data is embedded in this record.' };
  if (source.startsWith('blob:')) return { label: 'Temporary browser preview', detail: 'This preview does not confirm that an original was saved.' };
  if (/^https?:\/\//i.test(source)) return { label: 'Linked file', detail: 'Availability depends on the linked source.' };
  return { label: 'Storage not verified', detail: 'The file location could not be identified from this record.' };
}

export const TEXT_PREVIEW_MAX_BYTES = 64 * 1024;
export const isPlainTextType = (type: string) => type.split(';')[0].trim().toLowerCase() === 'text/plain';
interface PreviewUser { uid: string; getIdToken: () => Promise<string> }
interface TextPreviewOptions {
  getUser: () => PreviewUser | null;
  getSpace: () => string | null;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  knownSize?: number;
}
const sizeError = () => new Error('Text preview supports files up to 64 KB. Download the original to view this file.');

/** Read only a protected, current-space original. Never navigate/render its
 * content as HTML. Both advertised and streamed bytes are bounded. */
export async function readPlainTextPreview(source: string, options: TextPreviewOptions): Promise<string> {
  const user = options.getUser(), space = options.getSpace(), path = filePathFromReference(source);
  if (!user || !space || !/^[A-Za-z0-9_-]{1,128}$/.test(space) || !path || !path.startsWith(`families/${space}/`)) throw new Error('Open a protected file in your current space to preview its text.');
  if (options.knownSize && options.knownSize > TEXT_PREVIEW_MAX_BYTES) throw sizeError();
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 15_000);
  const check = () => {
    if (controller.signal.aborted || options.signal?.aborted) throw new Error('Text preview was stopped. Reopen the file to try again.');
    if (options.getUser() !== user || options.getSpace() !== space) throw new Error('Your account or space changed. Reopen the file to preview it.');
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    check();
    const token = await user.getIdToken(); check();
    const response = await (options.fetch || fetch)(fileContentUrl(path), {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    });
    check();
    if (!response.ok) throw new Error('The original is unavailable or you no longer have permission to open it.');
    if (!isPlainTextType(response.headers.get('content-type') || '')) throw new Error('This file is not plain text. Download the original to view it.');
    if (Number(response.headers.get('content-length')) > TEXT_PREVIEW_MAX_BYTES) throw sizeError();
    if (!response.body) throw new Error('No text was returned for this preview.');
    reader = response.body.getReader();
    controller.signal.addEventListener('abort', () => { void reader?.cancel().catch(() => {}); }, { once: true });
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const decode = (chunk?: Uint8Array, stream = false) => {
      try { return decoder.decode(chunk, { stream }); }
      catch { throw new Error('This file is not readable UTF-8 text. Download the original to view it.'); }
    };
    let bytes = 0, text = '';
    for (;;) {
      const result = await reader.read(); check();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > TEXT_PREVIEW_MAX_BYTES) throw sizeError();
      text += decode(result.value, true);
    }
    text += decode(); check();
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new Error('This file contains non-text data. Download the original to view it.');
    return text;
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    else controller.abort();
  }
}
