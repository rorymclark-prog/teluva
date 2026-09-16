/* ---------------------------------------------------------------------------
 * Uploading a NEW file straight from the trip pack's attach picker.
 *
 * The picker used to offer only what the vault already held — "this going to
 * already existing files annoying" (the app's owner, mid-packing): the boarding
 * pass is in Downloads and the consent letter is a screenshot on the clipboard,
 * and routing through the vault tab first means leaving the row you are trying
 * to complete. This is the missing path: file → vault → attached to the row,
 * one tap.
 *
 * Dedupe is by contentHash and SILENTLY attaches the existing copy instead of
 * refusing — in the vault's own upload form a duplicate is a question to ask;
 * here the user's intent ("this paper, on this row") is fully satisfied by the
 * copy that already exists, so asking would only be friction.
 * ------------------------------------------------------------------------- */

import { auth } from '../lib/firebase';
import { loadDocuments, saveDocuments, uploadVaultFile } from './db';
import { computeFileHash } from './documentDedup';
import type { TripDocRole, VaultCategory, VaultDocument } from '../types';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // same cap as the vault's own form

function newId() {
  return Date.now().toString() + Math.floor(Math.random() * 1000);
}

/** Where a trip paper belongs in the vault's own taxonomy. */
export function tripRoleToCategory(role: TripDocRole): VaultCategory {
  return role === 'passportCopy' || role === 'visa' || role === 'birthCertificate' ? 'Identity' : 'Travel';
}

export type TripUploadOutcome =
  | { kind: 'ok'; doc: VaultDocument; allDocs: VaultDocument[]; deduped: boolean }
  | { kind: 'error'; message: string };

/**
 * Put `file` into the vault (or find it already there by content) and return
 * the document to attach. The CALLER attaches it — attachment writes on the
 * trip event and this module has no business near the calendar.
 */
export async function uploadTripDocFile(
  file: File,
  role: TripDocRole,
  memberId?: string,
): Promise<TripUploadOutcome> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return { kind: 'error', message: 'That file is larger than 20 MB — please compress it first.' };
  }
  try {
    const hash = await computeFileHash(file);
    const current = await loadDocuments();
    const existing = current.find((d) => d.contentHash && d.contentHash === hash);
    if (existing) return { kind: 'ok', doc: existing, allDocs: current, deduped: true };

    const docId = newId();
    const { storagePath, downloadUrl } = await uploadVaultFile(file, docId);
    const doc: VaultDocument = {
      id: docId,
      name: (file.name || 'Document').replace(/\.[^.]+$/, ''),
      category: tripRoleToCategory(role),
      fileName: file.name || 'file',
      fileType: file.type || 'application/octet-stream',
      fileSize: file.size,
      storagePath,
      downloadUrl,
      uploadedAt: new Date().toISOString().slice(0, 10),
      uploadedBy: auth.currentUser?.displayName || auth.currentUser?.email || undefined,
      memberId: memberId || undefined,
      contentHash: hash,
    };
    // Base-merge save, like every other vault write — a concurrent edit
    // elsewhere merges instead of being clobbered.
    const next = [doc, ...current];
    const ok = await saveDocuments(next, current);
    if (ok === false) return { kind: 'error', message: 'Could not save the document — please try again.' };
    return { kind: 'ok', doc, allDocs: next, deduped: false };
  } catch (err) {
    console.error('Trip upload failed:', err);
    return { kind: 'error', message: 'Upload failed. Check your connection and try again.' };
  }
}

/**
 * The clipboard as a file source — "the consent letter is a screenshot I just
 * took". Returns null when the clipboard holds no image (text clipboards are
 * common and not an error), throws when the browser refuses access so the UI
 * can say how to fix that.
 */
export async function clipboardImageFile(): Promise<File | 'unreadable-file' | null> {
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (type) {
      const blob = await item.getType(type);
      const ext = type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
      const stamp = new Date().toISOString().slice(0, 10);
      return new File([blob], `Pasted image ${stamp}.${ext}`, { type });
    }
  }
  // A copied FILE (⌘C in the Finder/Files app) shows up here as a ClipboardItem
  // with NO readable types — the browser knows something is there but will only
  // release a file on a real paste keystroke or a drop, never to this API.
  // Verified empirically (Chrome/macOS, 2026-08-24): paste-event delivers the
  // File; clipboard.read() returns one item with types: []. Detecting the shape
  // lets the picker say "your file IS there — press ⌘V" instead of the
  // gaslighting "no image on the clipboard".
  if (items.some((item) => item.types.length === 0)) return 'unreadable-file';
  return null;
}
