import type { FamilyMember, VaultDocument } from '../types';
import type { DocReaderTarget } from './docReader';
export interface TimelineDocumentSource extends DocReaderTarget {
  sourceDocument?: { memberId: string; documentId: string };
  id: string; memberIds: string[]; vaultId?: string; fileName?: string;
}
/** Use saved ownership; never attribute another person's file to the selected person. */
export function timelineDocumentSources(members: FamilyMember[], vault: VaultDocument[], memberId?: string): TimelineDocumentSource[] {
  const out: TimelineDocumentSource[] = [];
  const add = (source: TimelineDocumentSource) => {
    const previous = out.find(d => (d.storagePath && d.storagePath === source.storagePath) || (d.src && d.src === source.src));
    if (previous) { previous.memberIds = [...new Set([...previous.memberIds, ...source.memberIds])]; return; }
    out.push(source);
  };
  for (const d of vault.filter(d => !memberId || !d.memberId || d.memberId === memberId)) add({id:`vault:${d.id}`,vaultId:d.id,name:d.name,category:d.category,fileName:d.fileName,fileType:d.fileType,src:d.downloadUrl,storagePath:d.storagePath,contentHash:d.contentHash,memberIds:d.memberId?[d.memberId]:[]});
  for (const m of members.filter(m => !memberId || m.id === memberId)) for (const d of m.documents || []) add({id:`member:${m.id}:${d.id}`,sourceDocument:{memberId:m.id,documentId:d.id},name:d.name,category:d.category,fileName:d.fileName,fileType:d.fileType,src:d.fileData,storagePath:d.storagePath,contentHash:d.contentHash,memberIds:[m.id]});
  return out;
}
/** Leave overlap for events crossing a page/paragraph boundary; review deduplicates it. */
export function timelineTextChunks(text: string, size = 18000): string[] {
  const chunks: string[] = [];
  for (let offset=0;offset<text.length;offset+=size-600) { chunks.push(text.slice(offset,offset+size)); if(offset+size>=text.length) break; }
  return chunks;
}
/** DOCX is a zip of XML; extract text locally, without executing macros or relationships. */
export async function extractTimelineDocx(data: ArrayBuffer): Promise<string> {
  if (data.byteLength > 20*1024*1024) throw new Error('Choose a document smaller than 20 MB.');
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(data);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('This is not a readable Word document. Export it as PDF and try again.');
  const xml = await entry.async('string');
  if (xml.length > 2000000) throw new Error('This Word document is too large to read here. Split it into smaller files.');
  const document = new DOMParser().parseFromString(xml,'application/xml');
  if (document.querySelector('parsererror')) throw new Error('This Word document could not be read.');
  return [...document.getElementsByTagNameNS('*','p')].map(p => [...p.getElementsByTagNameNS('*','t')].map(t => t.textContent || '').join('')).join('\n');
}
