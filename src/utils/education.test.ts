import assert from 'node:assert/strict';
import type { EducationDetails, FamilyMember, SchoolYear, VaultDocument } from '../types';
import { educationDocuments, savedEducationDocuments, upsertEducationYear } from './education';
import { mergeValue } from './mergeShared';
import { buildPack } from './exportPack';

const previous: SchoolYear = { id: 'old', label: '2025–26', schoolName: 'Old School', teacherName: 'Ms Old', reports: [{ id: 'report', title: 'Annual report', results: 'Excellent progress' }] };
const base: EducationDetails = { schoolName: 'Old School', teacherContact: 'old contact', currentYearId: 'old', schoolYears: [previous], qualifications: [{ id: 'degree', name: 'Degree' }] };
const next = upsertEducationYear(base, { id: 'new', label: '2026–27', schoolName: 'New School', teacherName: 'Mr New' }, true);
assert.deepEqual(next.schoolYears?.[0], previous, 'a new year preserves previous reports and teacher');
assert.equal(next.schoolName, 'New School');
assert.equal(next.teacherContact, '', 'old teacher contact must not follow the child to a new school');
assert.deepEqual(next.qualifications, base.qualifications);
const historicalEdit = upsertEducationYear(next, { ...previous, notes: 'Archived year' });
assert.equal(historicalEdit.schoolName, 'New School', 'editing history never overwrites current school');
assert.equal(base.schoolYears?.length, 1, 'updates never mutate the prior snapshot');
const concurrent = mergeValue(base, next, { ...base, schoolYears: [{ ...previous, reports: [...previous.reports!, { id: 'remote', title: 'Term report' }] }] }) as EducationDetails;
assert.ok(concurrent.schoolYears?.find(y => y.id === 'old')?.reports?.some(r => r.id === 'remote'), 'concurrent report survives a year rollover');

const member = { id: 'child', name: 'Child', role: 'Child', clothingSizes: {}, documents: [{ id: 'doc', name: 'Certificate', category: 'Other', fileName: 'cert.pdf', fileType: 'application/pdf', fileSize: 10, uploadedAt: '2026-01-01', fileData: 'https://example.test/cert' }],
  education: { ...next, qualifications: [{ id: 'q', name: 'First aid', documents: [{ id: 'member:doc', source: 'member', documentId: 'doc' }, { id: 'vault:shared', source: 'vault', documentId: 'shared' }] }] },
  addressHistory: [{ id: 'a', address: 'Previous home', startDate: '2020-01-01' }],
} as FamilyMember;
const vault = ['shared', 'other'].map(id => ({ id, name: id, category: 'Education', memberId: id === 'other' ? 'someone-else' : undefined, downloadUrl: `https://example.test/${id}`, fileName: `${id}.pdf`, fileType: 'application/pdf', fileSize: 10, uploadedAt: '2026-01-01', storagePath: '' })) as VaultDocument[];
assert.deepEqual(educationDocuments(member, vault).map(d => d.link.id), ['member:doc', 'vault:shared'], 'picker excludes another person’s documents');
const pack = buildPack({ title: 'Education', memberIds: ['child'], topics: ['education'] }, { members: [member], events: [], vaultDocuments: vault });
assert.match(pack.summaryMarkdown, /Excellent progress/);
assert.match(pack.summaryMarkdown, /First aid/);
assert.equal(pack.files.length, 2, 'linked files are included even when originally filed as Other or unassigned');
assert.ok(!pack.summaryMarkdown.includes('Previous home'), 'education-only exports exclude address history');
assert.ok(!pack.summaryMarkdown.includes('https://example.test'), 'export text never leaks file URLs');
const contact = buildPack({ title: 'Contact', memberIds: ['child'], topics: ['contact'] }, { members: [member], events: [], vaultDocuments: vault });
assert.match(contact.summaryMarkdown, /Previous home/);
console.log('education.test.ts: history, merge, document ownership and exports passed');

const uploaded = { ...member, education: undefined, documents: [{ ...member.documents[0], category: 'Education' as const }] };
assert.equal(savedEducationDocuments(uploaded, []).length, 1, 'unlinked profile certificates are immediately visible');
assert.equal(savedEducationDocuments(uploaded, [])[0].date, undefined, 'upload date never becomes achievement date');
const datedCopy = { ...vault[0], memberId: uploaded.id, downloadUrl: uploaded.documents[0].fileData, docDate: '2012-12-01' };
assert.equal(savedEducationDocuments(uploaded, [datedCopy]).length, 1, 'profile and vault copies deduplicate');
assert.equal(savedEducationDocuments(uploaded, [datedCopy])[0].date, '2012-12-01', 'printed date survives deduplication');
assert.equal(savedEducationDocuments(uploaded, [{ ...datedCopy, category: 'Other' }]).length, 1, 'misfiled vault copy must not hide profile education');
const linkedUpload = { ...uploaded, education: { qualifications: [{ id: 'q', name: 'Award', documents: [{ id: 'member:doc', source: 'member' as const, documentId: 'doc' }] }] } };
assert.equal(savedEducationDocuments(linkedUpload, [datedCopy]).length, 0, 'qualification absorbs linked upload and its duplicate');
assert.equal(savedEducationDocuments(uploaded, vault).filter(d => d.shared).length, 1, 'unassigned education is clearly shared');
assert.ok(!savedEducationDocuments(uploaded, vault).some(d => d.document.id === 'other'), 'other member ownership remains private');
