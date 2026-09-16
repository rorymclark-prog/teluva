import assert from 'node:assert/strict';
import type { CalendarEvent, FamilyMember } from '../types';
import { buildFamilyTimeline, filterFamilyTimeline, TIMELINE_CATEGORIES } from './familyTimeline';
const member = (id: string) => ({ id, name: id, role: 'Child', clothingSizes: {}, documents: [],
  addressHistory: [{ id: 'home', address: 'Old home', startDate: '2020-02-01', endDate: '2022-03-01' }, { id: 'unknown', address: 'Childhood house' }],
  education: { schoolYears: [{ id: 'year', label: '2025–26', schoolName: 'School', reports: [{ id: 'report', title: 'Annual report', date: '2026-06-01' }, { id: 'photo', kind: 'Class photo', title: 'Our class' }] }], qualifications: [{ id: 'q', name: 'Award', issueDate: '2026-05-01' }] },
  medical: { vaccinations: [{ id: 'v', name: 'MMR', date: '' }] },
}) as FamilyMember;
const members = [member('a'), member('b')];
const event: CalendarEvent = { id: 'appointment', title: 'Dentist', date: '2026-04-01', category: 'Appointment', remindMe: false, memberIds: ['a', 'b'] };
const input = { members, events: [event], now: new Date('2026-09-16'), memories: [{ id: 'story', date: '2026-07-01', title: 'Summer', memberIds: ['a'] }] };
const all = buildFamilyTimeline(input);
const medical = all.filter(i => i.title === 'Dentist');
assert.equal(medical.length, 1, 'one shared calendar appointment must not become three timeline rows');
assert.deepEqual(medical[0].memberIds, ['a', 'b']);
assert.equal(all.find(i => i.id === 'school:a:year')?.date, '2025', 'academic year has year precision; never invent a school start day');
assert.equal(all.find(i => i.id === 'report:a:photo')?.date, '', 'undated photos stay undated');
assert.equal(all.find(i => i.id === 'report:a:photo')?.sourceLabel, 'Class photo');
assert.ok(all.some(i => i.title === 'Childhood house' && !i.date));
const education = filterFamilyTimeline(all, { categories: ['education'], memberId: 'a' });
assert.equal(education.length, 4);
assert.ok(education.every(i => i.memberIds.includes('a') && i.category === 'education'));
assert.equal(filterFamilyTimeline(all, { categories: [], search: '' }).length, 0, 'all toggles off means no records');
assert.ok(filterFamilyTimeline(all, { categories: [...TIMELINE_CATEGORIES], year: 'undated' }).every(i => !i.date));
const changed = buildFamilyTimeline({ ...input, members: [{ ...members[0], education: { schoolYears: [], qualifications: [] } }, members[1]] });
assert.ok(!changed.some(i => i.category === 'education' && i.memberIds.includes('a')), 'deleting source records removes derived timeline entries');
assert.equal(filterFamilyTimeline(all, { categories: ['addresses'], search: 'childhood' }).length, 2);
const asc = filterFamilyTimeline(all, { categories: [...TIMELINE_CATEGORIES], oldestFirst: true });
assert.equal(asc[0].date, '2020-02-01');
assert.equal(asc.at(-1)?.date, '', 'undated stays at the end in both sort orders');
assert.deepEqual(all.filter(i => i.manual).map(i => i.manual?.id), ['story'], 'only actual memories are editable in the timeline');
console.log('familyTimeline.test.ts: categories, filtering, ownership, dates and source updates passed');
const photoMember = member('photo-owner');
photoMember.documents = [{ id: 'picture', name: 'Class photograph', category: 'Education', fileType: 'image/jpeg', fileData: 'data:image/jpeg;base64,fixture', fileName: 'class.jpg', fileSize: 10, uploadedAt: '2026-09-01' }];
photoMember.education!.schoolYears![0].reports![0].documents = [{ id: 'member:picture', source: 'member', documentId: 'picture' }];
assert.equal(buildFamilyTimeline({ members: [photoMember] }).find(i => i.id === 'report:photo-owner:report')?.imageUrl, 'data:image/jpeg;base64,fixture');
photoMember.education!.schoolYears![0].reports![0].documents = [{ id: 'vault:picture', source: 'vault', documentId: 'picture' }];
const vaultPhoto = { ...photoMember.documents[0], category: 'Education' as const, storagePath: '', memberId: 'someone-else', downloadUrl: 'https://example.test/private.jpg' };
assert.equal(buildFamilyTimeline({ members: [photoMember], vault: [vaultPhoto] }).find(i => i.id === 'report:photo-owner:report')?.imageUrl, undefined, 'a wrong-owner vault attachment must not be exposed in a timeline preview');
assert.equal(buildFamilyTimeline({ members: [photoMember], vault: [{ ...vaultPhoto, memberId: photoMember.id }] }).find(i => i.id === 'report:photo-owner:report')?.imageUrl, vaultPhoto.downloadUrl);
