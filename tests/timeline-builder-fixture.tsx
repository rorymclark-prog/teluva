// Local browser fixture: fictional data, controlled AI response, no cloud writes.
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import TimelineImportModal from '../src/components/TimelineImportModal';
import MemberCV from '../src/components/MemberCV';
import {timelineDocumentSources} from '../src/utils/timelineDocuments';
import {sanitizeTimelineRows} from '../server/timelineParse.mjs';
import type {FamilyMember,TimelineEntry} from '../src/types';
import '../src/index.css';
const realFetch=window.fetch.bind(window);
window.fetch=async (url,init)=>{
 if(url==='/api/timeline/parse') {
  const {text,members}=JSON.parse(String(init?.body));
  const rows=[{date:'2013-01-01',datePrecision:'year',title:'Started at Example Studio',category:'work',memberIds:[],sourceText:'2013 Started at Example Studio'},{date:'',title:'First aid certificate',category:'school',memberIds:[],sourceText:'First aid certificate, date unknown'},{date:'2020-01-01',title:'Invented award',category:'school',memberIds:[],sourceText:'Not in the source'}];
  return new Response(JSON.stringify({rows:sanitizeTimelineRows({rows},members,text)}),{headers:{'Content-Type':'application/json'}});
 }
 return realFetch(url,init);
};
const makeDocument=(id:string,name:string,text:string)=>({id,name,category:'Other' as const,fileType:'text/plain',fileName:`${id}.txt`,fileSize:100,uploadedAt:'2026-09-16',fileData:`data:text/plain,${encodeURIComponent(text)}`});
const owner:FamilyMember={id:'a',name:'Alex Example',role:'Parent',avatarColor:'',clothingSizes:{},documents:[makeDocument('cv','Example CV','2013 Started at Example Studio\nFirst aid certificate, date unknown'),{...makeDocument('bad','Unreadable file',''),fileType:'application/pdf',fileData:'data:application/pdf;base64,bm90IGEgcGRm'}],cv:{roles:[{id:'role',title:'Designer',startDate:'2013-01-01'}]}};
const shared={...makeDocument('shared','Shared project note','2013 Started at Example Studio'),category:'Other' as const,storagePath:'',downloadUrl:makeDocument('shared','x','2013 Started at Example Studio').fileData};
function Fixture(){
 const [open,setOpen]=useState(false),[member,setMember]=useState(owner),[saved,setSaved]=useState<TimelineEntry[]>([]);
 return <main style={{padding:20,maxWidth:1000,margin:'auto'}}><p>Fictional browser fixture. AI response is controlled; not a live model test.</p><MemberCV member={member} canEdit onUpdate={patch=>setMember(m=>({...m,...patch}))} onViewDocument={()=>{}} onBuildTimeline={()=>setOpen(true)}/><button onClick={()=>setOpen(true)}>Open builder</button><output aria-label="Saved entries">{JSON.stringify(saved)}</output><TimelineImportModal open={open} onClose={()=>setOpen(false)} members={[member]} defaultMemberId="a" existing={saved} documents={timelineDocumentSources([member],[shared])} onImport={entries=>setSaved(s=>[...s,...entries])}/></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
