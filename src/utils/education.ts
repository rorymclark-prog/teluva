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
}

export function educationDocuments(member: FamilyMember, vault: VaultDocument[]): EducationDocumentOption[] {
  return [
    ...(member.documents || []).map(document => ({
      link: { id: `member:${document.id}`, source: 'member' as const, documentId: document.id }, document,
    })),
    ...vault.filter(d => d.memberId === member.id || (!d.memberId && d.category === 'Education')).map(d => ({
      link: { id: `vault:${d.id}`, source: 'vault' as const, documentId: d.id },
      document: { id: d.id, name: d.name, category: 'Education' as const, fileName: d.fileName,
        fileType: d.fileType, fileSize: d.fileSize, fileData: d.downloadUrl, uploadedAt: d.uploadedAt, notes: d.notes },
    })),
  ];
}

export function educationDocumentLinks(education?: EducationDetails): EducationDocumentLink[] {
  return [
    ...(education?.schoolYears || []).flatMap(y => (y.reports || []).flatMap(r => r.documents || [])),
    ...(education?.qualifications || []).flatMap(q => q.documents || []),
  ];
}
