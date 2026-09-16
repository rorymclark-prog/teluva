// The bridge between the two document shapes this app grew: VaultDocument
// (the shared family vault, Storage-backed, downloadUrl) and FamilyDocument
// (per-member documents, fileData-backed) — which is what DocumentViewer
// renders. Extracted from DocumentVault so every screen that wants to open a
// vault document in the viewer converts it the SAME way; a second hand-rolled
// copy of this mapping is how one written category ends up in two spellings.

import type { VaultDocument, FamilyDocument, VaultCategory } from '../types';

export const VAULT_CATEGORY_TO_FAMILY: Record<VaultCategory, FamilyDocument['category']> = {
  Identity: 'ID', Education: 'Education', Medical: 'Health',
  Financial: 'Other', Legal: 'Other', Travel: 'Travel', Other: 'Other',
};

/** A vault document as the viewer expects it. `fileData` carries the URL —
 *  DocumentViewer feeds it straight into an <img>/<iframe> src, which takes a
 *  https URL as happily as a data URI. */
export function toFamilyDoc(v: VaultDocument): FamilyDocument {
  return {
    id: v.id, name: v.name, category: VAULT_CATEGORY_TO_FAMILY[v.category],
    fileType: v.fileType, fileName: v.fileName, fileSize: v.fileSize,
    uploadedAt: v.uploadedAt, notes: v.notes, fileData: v.downloadUrl,
    keyFacts: v.keyFacts,
  };
}
