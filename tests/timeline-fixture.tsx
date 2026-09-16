// Local-only browser fixture. Runs the production components in demo mode;
// fictional records, no credentials, no writes to household data.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import MemberEducation from '../src/components/MemberEducation';
import TimelineView from '../src/components/TimelineView';
import '../src/index.css';
import type { FamilyMember, CalendarEvent } from '../src/types';
const adult: FamilyMember = { id: 'adult', name: 'Alex Example', birthdate: '1975-03-12', role: 'Parent', avatarColor: '', clothingSizes: {}, documents: [], addressHistory: [{ id: 'home', address: 'Example home', label: 'First home', startDate: '1998-01-01', endDate: '2010-06-01' }], education: { schoolYears: [{ id: 'school', label: '1981–82', schoolName: 'Example school', reports: [{ id: 'undated', title: 'Undated award', kind: 'Achievement', date: '' }] }] } };
const child: FamilyMember = { ...adult, id: 'child', name: 'Sam Example', birthdate: '2015-06-01', role: 'Child', education: undefined, addressHistory: [] };
const events: CalendarEvent[] = ['Big shopping: Alex', 'Alex picks up Sam', 'Alex dentist'].map((title, i) => ({ id: `gcal-${i}`, title, date: `2026-09-0${i+1}`, category: 'Appointment', memberIds: ['adult'], remindMe: false }));
const dense = { ...adult, education: { schoolYears: Array.from({ length: 52 }, (_, i) => ({ id: `year-${i}`, label: `${1975+i}`, schoolName: `Chapter ${1975+i}`, reports: Array.from({ length: 12 }, (_, month) => ({ id: `${i}-${month}`, title: `Achievement ${1975+i}-${month+1}`, kind: 'Achievement' as const, date: `${1975+i}-${String(month+1).padStart(2,'0')}-15` })) })) } };
function Fixture() {
 const [scenario, setScenario] = useState('sparse');
 const [source, setSource] = useState('');
 const [educationMember, setEducationMember] = useState<FamilyMember>({...adult, documents:[{id:'cert',name:'Permaculture certificate',category:'Education',fileName:'certificate.pdf',fileType:'image/svg+xml',fileSize:20,fileData:"data:image/svg+xml;charset=utf-8,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="white"/><text x="30" y="180" font-size="28">Example certificate - test only</text></svg>'),uploadedAt:'2026-09-16'}],education:{qualifications:[{id:'cert-q',name:'Permaculture qualification',issueDate:'2012-12-02',documents:[{id:'member:cert',source:'member',documentId:'cert'}]}]}});
 const business = scenario === 'business';
 const list = scenario === 'empty' ? [] : scenario === 'dense' ? [dense, child] : scenario === 'birth-only' ? [{ ...child, education: undefined, addressHistory: [] }] : [adult, child];
 return <main style={{ padding: 12, maxWidth: 1400, margin: 'auto' }}><label>Test scenario <select value={scenario} onChange={e => setScenario(e.target.value)}><option value="sparse">Sparse lifetime</option><option value="dense">Dense lifetime</option><option value="birth-only">Birth only</option><option value="empty">Empty history</option><option value="business">Business</option><option value="education">Education uploads</option></select></label><output aria-label="Opened source">{source}</output><section key={scenario}>{scenario === 'education' ? <><MemberEducation member={educationMember} onUpdate={async patch => setEducationMember(m => ({...m,...patch}))} canEdit onViewDocument={d => setSource(d.name)} /><TimelineView demo members={[educationMember]} events={[]} /></> : <TimelineView demo members={list} events={scenario === 'birth-only' || scenario === 'empty' ? [] : business ? [{ id: 'milestone', title: 'Business opened', date: '2001-03-01', category: 'Milestone', remindMe: false }] : events} isBusinessSpace={business} onOpenMemberTab={(id, tab) => setSource(`${id}:${tab}`)} />}</section></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
