import type { EducationDetails, EducationDocumentLink, FamilyDocument, FamilyMember, SchoolYear, VaultDocument } from '../types';

export function upsertEducationYear(education: EducationDetails, year: SchoolYear, current = false): EducationDetails {
  const years = education.schoolYears || [];
  const next = { ...education, schoolYears: years.some(y => y.id === year.id)
    ? years.map(y => y.id === year.id ? year : y) : [...years, year] };
  if (!current && education.currentYearId !== year.id) return next;
  // Keep legacy school details usable in Overview, carer shares and exports.
  return { ...next, currentYearId: year.id, schoolName: year.schoolName,
    grade: year.grade || '', teacherName: year.teacherName || '', teacherContact: year.teacherContact || '',
    roomNumber: year.roomNumber || '', scheduleNotes: year.scheduleNotes || '' };
}

export interface EducationDocumentOption {
  link: EducationDocumentLink;
  document: FamilyDocument;
  date?: string;
  shared?: boolean;
}

export function educationDocuments(member: FamilyMember, vault: VaultDocument[]): EducationDocumentOption[] {
  return [
    ...(member.documents || []).map(document => ({
      link: { id: `member:${document.id}`, source: 'member' as const, documentId: document.id }, document,
    })),
    ...vault.filter(d => d.memberId === member.id || (!d.memberId && d.category === 'Education')).map(d => ({
      link: { id: `vault:${d.id}`, source: 'vault' as const, documentId: d.id },
      date: d.docDate, shared: !d.memberId,
      document: { id: d.id, name: d.name, category: (d.category === 'Medical' ? 'Health' : d.category === 'Identity' ? 'ID' : ['Education', 'Travel'].includes(d.category) ? d.category : 'Other') as FamilyDocument['category'], fileName: d.fileName,
        fileType: d.fileType, fileSize: d.fileSize, fileData: d.downloadUrl, storagePath: d.storagePath, contentHash: d.contentHash, uploadedAt: d.uploadedAt, notes: d.notes },
    })),
  ];
}

export function sameEducationFile(a: Pick<FamilyDocument, 'id' | 'storagePath' | 'contentHash' | 'fileData'>, b: Pick<FamilyDocument, 'id' | 'storagePath' | 'contentHash' | 'fileData'>): boolean {
  return !!((a.storagePath && a.storagePath === b.storagePath) || (a.contentHash && a.contentHash === b.contentHash) || (a.fileData && a.fileData === b.fileData));
}

/** Existing uploads are visible without asking the user to upload or enter them again. */
export function savedEducationDocuments(member: FamilyMember, vault: VaultDocument[]): EducationDocumentOption[] {
  const options = educationDocuments(member, vault);
  const links = educationDocumentLinks(member.education);
  const linked = options.filter(o => links.some(link => link.source === o.link.source && link.documentId === o.link.documentId));
  const saved: EducationDocumentOption[] = [];
  for (const option of options.filter(o => o.document.category === 'Education').sort((a, b) => Number(!!b.date) - Number(!!a.date))) {
    if (linked.some(o => o.link.id === option.link.id || sameEducationFile(o.document, option.document))) continue;
    if (saved.some(o => sameEducationFile(o.document, option.document))) continue;
    saved.push(option);
  }
  return saved;
}

export function educationDocumentLinks(education?: EducationDetails): EducationDocumentLink[] {
  return [
    ...(education?.schoolYears || []).flatMap(y => (y.reports || []).flatMap(r => r.documents || [])),
    ...(education?.qualifications || []).flatMap(q => q.documents || []),
  ];
}
