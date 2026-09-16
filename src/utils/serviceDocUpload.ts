/* ---------------------------------------------------------------------------
 * Putting a service receipt INTO the vault, from the service form.
 *
 * Same shape as tripDocUpload.ts (which it follows deliberately): 20 MB cap,
 * dedupe by content hash, upload to Storage, base-merge save of the
 * `documents` doc. The caller links the returned id onto its service entry —
 * this module never touches the household doc.
 *
 * A duplicate SILENTLY attaches the copy already in the vault: the intent
 * ("this receipt, on this service") is fully met by the copy that exists, so
 * asking would be friction.
 *
 * Category 'Financial': a receipt or invoice is a record of money spent, and
 * that is where the vault's own taxonomy puts one (there is no 'Vehicle' or
 * 'Home' category, and inventing one here would split the vault's filter).
 * ------------------------------------------------------------------------- */

import { auth } from '../lib/firebase';
import { loadDocuments, saveDocuments, uploadVaultFile } from './db';
import { computeFileHash } from './documentDedup';
import type { VaultDocument } from '../types';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // same cap as the vault's own form

const newId = () => Date.now().toString() + Math.floor(Math.random() * 1000);

export type ServiceUploadOutcome =
  | { kind: 'ok'; doc: VaultDocument; allDocs: VaultDocument[]; deduped: boolean }
  | { kind: 'error'; message: string };

function extOf(file: File): string {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(file.name || '')?.[1];
  if (fromName) return fromName.toLowerCase();
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type.startsWith('image/')) return file.type.split('/')[1].replace('jpeg', 'jpg');
  return 'bin';
}

/** The scanner hands back a data URL; the vault wants a File. */
export async function dataUrlToFile(dataUrl: string, name: string, type: string): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], name, { type: type || blob.type || 'application/octet-stream' });
}

export async function uploadServiceDocFile(
  file: File,
  opts: { name: string; memberId?: string; notes?: string },
): Promise<ServiceUploadOutcome> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return { kind: 'error', message: 'That file is larger than 20 MB — please compress it first.' };
  }
  try {
    const hash = await computeFileHash(file);
    const current = await loadDocuments();
    const existing = current.find((d) => d.contentHash && d.contentHash === hash);
    if (existing) return { kind: 'ok', doc: existing, allDocs: current, deduped: true };

    const docId = newId();
    // Storage keeps the auto-name as the file name too, so a download from the
    // vault arrives as "Trek FX — service 10 Sep 2026.pdf", not "scan-1.pdf".
    const named = new File([file], `${opts.name}.${extOf(file)}`, { type: file.type });
    const { storagePath, downloadUrl } = await uploadVaultFile(named, docId);
    const doc: VaultDocument = {
      id: docId,
      name: opts.name,
      category: 'Financial',
      fileName: named.name,
      fileType: file.type || 'application/octet-stream',
      fileSize: file.size,
      storagePath,
      downloadUrl,
      uploadedAt: new Date().toLocaleDateString('en-CA'),
      uploadedBy: auth.currentUser?.displayName || auth.currentUser?.email || undefined,
      memberId: opts.memberId || undefined,
      notes: opts.notes || undefined,
      contentHash: hash,
    };
    const next = [doc, ...current];
    const ok = await saveDocuments(next, current);
    if (ok === false) return { kind: 'error', message: 'Could not save the document — please try again.' };
    return { kind: 'ok', doc, allDocs: next, deduped: false };
  } catch (err) {
    console.error('Service receipt upload failed:', err);
    return { kind: 'error', message: 'Upload failed. Check your connection and try again.' };
  }
}

/* Demo mode has no vault (the Document Vault screen is DemoUnavailable), but
 * the flow still has to be tryable end to end. The file stays in this tab as
 * an object URL and vanishes on reload — exactly what every demo edit does. */
export function localServiceDoc(file: File, opts: { name: string; memberId?: string }): VaultDocument {
  return {
    id: 'demo-' + newId(),
    name: opts.name,
    category: 'Financial',
    fileName: `${opts.name}.${extOf(file)}`,
    fileType: file.type || 'application/octet-stream',
    fileSize: file.size,
    storagePath: '',
    downloadUrl: URL.createObjectURL(file),
    uploadedAt: new Date().toLocaleDateString('en-CA'),
    memberId: opts.memberId || undefined,
  };
}
