import React, { useEffect, useRef, useState } from 'react';
import { X, ArrowLeft, ArrowRight, Sparkles, Camera, Check } from 'lucide-react';
import {
  FamilyMember, HubSettings, FamilyDocument, PassportRecord, IdentityRecord,
  HealthcareProvider, HouseholdInfo, IdCountry,
} from '../types';
import { loadFamilyInfo, saveFamilyInfo, loadHousehold, saveHousehold } from '../utils/db';
import { getInterviewState, saveInterviewStep, markInterviewSeen } from '../utils/interview';
import { COUNTRY_OPTIONS } from './HubSettingsModal';
import DocumentScannerModal, { ScannedFile } from './DocumentScannerModal';

// ---------------------------------------------------------------------------
// Why this exists, and how it decides what to ask
// ---------------------------------------------------------------------------
//
// A brand-new vault is empty, and "haven't got round to it" is the single
// biggest reason people never fill one in (see the handoff brief). This walks
// a family through ~15-20 short, conversational questions — ordered so the
// highest-stakes facts (blood group, allergies, who to call) come first, the
// most likely near-term save (a passport expiry) comes early too, and every
// answer writes straight through the SAME save paths the rest of the app
// uses (onAddMember/onPatchMember/onAddDocument from Dashboard, saveFamilyInfo/
// saveHousehold from utils/db) — there is no parallel store.
//
// Every question is skippable (clicking through with a field empty is not a
// special case — it's just how Next works). The whole thing is abandonable
// at any point (the X pauses, it does not discard) and resumable (the current
// question is persisted after every answer — see utils/interview.ts — so
// returning lands exactly where you stopped). "Skip the rest" ends it outright,
// the same as finishing.
//
// SEQUENCE. Family-wide questions (who's in the family, what country) come
// first, then three short questions PER MEMBER (health essentials, emergency
// contact, ID/passport), then two more family-wide questions (doctor,
// household), then a closing screen. The per-member block is rebuilt from the
// LIVE members list every time this recomputes the sequence — see
// buildSequence() — which is what makes "who's in the family" step 1 actually
// unlock everything that follows, and what makes resuming safe even if the
// family list changed since the interview was last open.

type FixedStepId = 'welcome' | 'members' | 'country' | 'doctor' | 'household' | 'closing';
type MemberSub = 'health' | 'emergency' | 'id';
interface ParsedToken {
  kind: FixedStepId | 'member';
  memberId?: string;
  sub?: MemberSub;
}

function parseToken(token: string): ParsedToken {
  if (token.startsWith('member:')) {
    const [, memberId, sub] = token.split(':');
    return { kind: 'member', memberId, sub: sub as MemberSub };
  }
  return { kind: token as FixedStepId };
}

function buildSequence(members: FamilyMember[]): string[] {
  const seq: string[] = ['welcome', 'members', 'country'];
  for (const m of members) {
    seq.push(`member:${m.id}:health`, `member:${m.id}:emergency`, `member:${m.id}:id`);
  }
  seq.push('doctor', 'household', 'closing');
  return seq;
}

function newId(): string {
  return Date.now().toString() + Math.floor(Math.random() * 1000);
}

// One extra ID field per country, on top of the universal passport — mirrors
// the field MemberIDs.tsx treats as that country's headline identity number
// (UK reuses `medicalAidNumber` for the NHS number there too; see its
// UKFields component).
const COUNTRY_ID_FIELD: Record<IdCountry, { key: keyof IdentityRecord; label: string; placeholder: string }> = {
  AT: { key: 'svNumber', label: 'Sozialversicherungsnummer (SV number)', placeholder: 'e.g. 1234 010190' },
  ZA: { key: 'nationalIdNumber', label: 'SA ID number', placeholder: 'e.g. 9001015800086' },
  UK: { key: 'medicalAidNumber', label: 'NHS number', placeholder: 'NHS number' },
  US: { key: 'nationalIdNumber', label: 'Social Security number', placeholder: 'e.g. 123-45-6789' },
  other: { key: 'nationalIdNumber', label: 'National ID number', placeholder: 'National ID / equivalent' },
};

interface FamilyInterviewProps {
  uid: string | null;
  demo: boolean;
  /** True once initial data has loaded AND the AI consent prompt (if any) is dealt with — same gate FirstRunTour uses. */
  ready: boolean;
  /** False for business spaces and for anyone who can't write (children) — the interview never shows, and settles immediately so FirstRunTour isn't blocked waiting on it. */
  enabled: boolean;
  members: FamilyMember[];
  settings: HubSettings;
  onAddMember: (m: Omit<FamilyMember, 'documents'>) => Promise<void>;
  onPatchMember: (memberId: string, patch: Partial<FamilyMember>) => Promise<void>;
  onAddDocument: (memberId: string, doc: FamilyDocument) => Promise<void>;
  onSaveSettings: (s: HubSettings) => Promise<void> | void;
  /** Fires exactly once per activation, whether the interview actually ran or not (not enabled / already seen / paused / finished). Dashboard uses this to gate FirstRunTour so the two never show at once. */
  onSettled: () => void;
  /** Bump to force a full restart from "Welcome" — "Redo the guided setup" in Hub settings. */
  forceKey?: number;
}

const EMPTY_HOUSEHOLD: HouseholdInfo = { address: '', doorCode: '', wifiName: '', wifiPassword: '', utilities: [], vehicles: [], pets: [], locations: [] };

export default function FamilyInterview({
  uid, demo, ready, enabled, members, settings,
  onAddMember, onPatchMember, onAddDocument, onSaveSettings,
  onSettled, forceKey = 0,
}: FamilyInterviewProps) {
  const [status, setStatus] = useState<'idle' | 'checking' | 'active' | 'done'>('idle');
  const [token, setToken] = useState('welcome');
  const [busy, setBusy] = useState(false);

  const checkedOnce = useRef(false);
  const lastForceKey = useRef(forceKey);
  const membersRef = useRef(members);
  useEffect(() => { membersRef.current = members; }, [members]);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const cardRef = useRef<HTMLDivElement>(null);

  const settle = () => { setStatus('done'); onSettledRef.current(); };

  useEffect(() => {
    const forced = forceKey !== lastForceKey.current;
    lastForceKey.current = forceKey;

    if (forced) {
      setToken('welcome');
      setStatus('active');
      return;
    }
    if (!enabled) {
      if (status === 'idle') settle();
      return;
    }
    if (!ready || checkedOnce.current || status !== 'idle') return;
    checkedOnce.current = true;
    setStatus('checking');
    getInterviewState(uid, demo).then((s) => {
      if (s.seen) { settle(); return; }
      // Never started before, and this is an established family (already has
      // members) — don't force a blank-page flow onto an account that's
      // clearly past that stage. Still reachable any time from Hub settings.
      const startedBefore = !!s.step && s.step !== 'welcome';
      if (!startedBefore && membersRef.current.length > 0) { settle(); return; }
      setToken(s.step || 'welcome');
      setStatus('active');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, forceKey, enabled]);

  // Holds whichever step body is currently rendered's save function —
  // reassigned (during render, harmless: it's a ref, not state) every time a
  // step body renders, and always read at CALL time inside advance()/pause(),
  // so it's never stale and never depends on closure/declaration ordering.
  const commitRef = useRef<() => Promise<void>>(async () => {});
  const registerCommit = (fn: () => Promise<void>) => { commitRef.current = fn; };

  const goto = (next: string) => {
    setToken(next);
    void saveInterviewStep(uid, demo, next);
  };

  const advance = async (dir: 1 | -1) => {
    setBusy(true);
    try {
      await commitRef.current();
    } finally {
      setBusy(false);
    }
    const s = buildSequence(membersRef.current);
    const i = Math.max(0, s.indexOf(token));
    goto(s[Math.min(Math.max(i + dir, 0), s.length - 1)]);
  };

  const pause = async () => {
    await commitRef.current();
    settle();
  };

  const skipTheRest = () => {
    setStatus('done');
    void markInterviewSeen(uid, demo);
    onSettledRef.current();
  };

  const finish = () => {
    setStatus('done');
    void markInterviewSeen(uid, demo);
    onSettledRef.current();
  };

  useEffect(() => {
    if (status === 'active') cardRef.current?.focus();
  }, [status, token]);

  useEffect(() => {
    if (status !== 'active') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') void pause(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (status !== 'active') return null;

  const parsed = parseToken(token);
  const seq = buildSequence(membersRef.current);
  const idx = Math.max(0, seq.indexOf(token));
  const isFirst = idx === 0;
  const isLast = idx === seq.length - 1;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 overflow-y-auto">
      <div className="fixed inset-0 bg-ink-900/55 backdrop-blur-sm anim-fade" />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="interview-step-title"
        tabIndex={-1}
        className="card relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl p-6 anim-pop outline-none"
      >
        <div className="mx-auto mt-[-8px] mb-2 h-1 w-9 rounded-full bg-cream-400 sm:hidden" />

        {/* Header: honest progress + pause */}
        <div className="flex items-center justify-between gap-3 mb-4">
          {parsed.kind !== 'welcome' && parsed.kind !== 'closing' ? (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 tabular-nums">
              Question {idx + 1} of {seq.length}
            </p>
          ) : <span />}
          <button
            type="button"
            onClick={pause}
            className="shrink-0 -m-1 p-1 text-ink-400 hover:text-ink-700 rounded-lg hover:bg-cream-100 transition-colors cursor-pointer"
            aria-label="Pause setup — come back any time from Hub settings"
            title="Pause"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {parsed.kind === 'welcome' && <WelcomeStep />}
        {parsed.kind === 'members' && (
          <MembersStep members={membersRef.current} onAddMember={onAddMember} />
        )}
        {parsed.kind === 'country' && (
          <CountryStep settings={settings} onSaveSettings={onSaveSettings} registerCommit={registerCommit} />
        )}
        {parsed.kind === 'member' && parsed.sub === 'health' && (
          <MemberHealthStep member={membersRef.current.find(m => m.id === parsed.memberId)} onPatchMember={onPatchMember} registerCommit={registerCommit} />
        )}
        {parsed.kind === 'member' && parsed.sub === 'emergency' && (
          <MemberEmergencyStep member={membersRef.current.find(m => m.id === parsed.memberId)} onPatchMember={onPatchMember} registerCommit={registerCommit} />
        )}
        {parsed.kind === 'member' && parsed.sub === 'id' && (
          <MemberIdStep
            member={membersRef.current.find(m => m.id === parsed.memberId)}
            country={settings.country || 'AT'}
            onPatchMember={onPatchMember}
            onAddDocument={onAddDocument}
            registerCommit={registerCommit}
          />
        )}
        {parsed.kind === 'doctor' && <DoctorStep demo={demo} registerCommit={registerCommit} />}
        {parsed.kind === 'household' && <HouseholdStep demo={demo} registerCommit={registerCommit} />}
        {parsed.kind === 'closing' && <ClosingStep />}

        {/* Footer */}
        {parsed.kind === 'welcome' ? (
          <div className="flex flex-col items-center gap-2 mt-5 pt-4 border-t border-cream-200">
            <button type="button" onClick={() => advance(1)} disabled={busy} className="btn-primary px-5 py-2.5 w-full justify-center">
              <span>Let's go</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={skipTheRest} className="text-[12px] text-ink-400 hover:text-ink-600 underline underline-offset-2 cursor-pointer">
              Skip — I'll set this up myself
            </button>
          </div>
        ) : parsed.kind === 'closing' ? (
          <div className="flex justify-end mt-5 pt-4 border-t border-cream-200">
            <button type="button" onClick={finish} className="btn-primary px-4 py-2 text-[13px]">
              <Check className="w-3.5 h-3.5" />
              <span>Done</span>
            </button>
          </div>
        ) : (
          <div className="mt-5 pt-3.5 border-t border-cream-200 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => advance(-1)}
                disabled={isFirst || busy}
                className="btn-quiet px-3 py-2 text-[13px] disabled:opacity-0 disabled:pointer-events-none"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
              <button type="button" onClick={() => advance(1)} disabled={busy} className="btn-primary px-4 py-2 text-[13px]">
                <span>{isLast ? 'Continue' : 'Next'}</span>
                {!isLast && <ArrowRight className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="text-center">
              <button type="button" onClick={skipTheRest} className="text-[12px] text-ink-400 hover:text-ink-600 underline underline-offset-2 cursor-pointer">
                Skip the rest — I'll set this up myself
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Step bodies ─────────────────────────── */

function StepHeader({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h3 id="interview-step-title" className="font-display text-lg font-semibold text-ink-900 leading-snug">
        {title}
      </h3>
      <p className="text-[13.5px] text-ink-600 leading-relaxed mt-1.5 mb-4">{body}</p>
    </>
  );
}

function WelcomeStep() {
  return (
    <>
      <div className="w-10 h-10 rounded-2xl bg-clay-50 text-clay-600 flex items-center justify-center mb-3">
        <Sparkles className="w-5 h-5" />
      </div>
      <StepHeader
        title="Let's fill up your vault"
        body="A blank vault doesn't help anyone. A few honest questions — the kind that actually matter in a real emergency — and yours won't be blank anymore. Answer what you know, skip what you don't, stop whenever you like: everything you enter along the way is saved and useful on its own."
      />
    </>
  );
}

function ClosingStep() {
  return (
    <StepHeader
      title="That's it — you're genuinely set up"
      body="Add photos, more documents, and everyone else's details whenever you like — from each person's profile, or from Info and Household in the menu. Come back to this setup any time from Hub settings if you want to fill in more, or redo it from scratch."
    />
  );
}

/* --- Who's in your family? --- */

function MembersStep({ members, onAddMember }: {
  members: FamilyMember[];
  onAddMember: (m: Omit<FamilyMember, 'documents'>) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [role, setRole] = useState<'Parent' | 'Child' | 'Grandparent' | 'Other'>(members.length === 0 ? 'Parent' : 'Child');
  const [adding, setAdding] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    setAdding(true);
    try {
      await onAddMember({
        id: newId(),
        name: name.trim(),
        role,
        birthdate: birthdate || undefined,
        avatarColor: 'bg-clay-500',
        isOnline: true,
        clothingSizes: {},
      });
      setName('');
      setBirthdate('');
      setRole('Child');
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <StepHeader
        title="Who's this vault for?"
        body="Add the people in your family — just a name and, if you know it, a birthday. Photos, sizes and everything else can wait."
      />
      {members.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {members.map(m => (
            <span key={m.id} className="chip bg-sage-100 text-sage-700">{m.name}</span>
          ))}
        </div>
      )}
      <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
        <input
          autoFocus
          className="field"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }}
        />
        <div className="grid grid-cols-2 gap-2.5">
          <input type="date" className="field" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
          <select className="field" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="Parent">Parent</option>
            <option value="Child">Child</option>
            <option value="Grandparent">Grandparent</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <button type="button" onClick={() => void add()} disabled={!name.trim() || adding} className="btn-primary w-full justify-center text-[13px] disabled:opacity-50">
          Add {name.trim() ? name.trim() : 'person'}
        </button>
      </div>
    </>
  );
}

/* --- Country --- */

function CountryStep({ settings, onSaveSettings, registerCommit }: {
  settings: HubSettings;
  onSaveSettings: (s: HubSettings) => Promise<void> | void;
  registerCommit: (fn: () => Promise<void>) => void;
}) {
  const [country, setCountry] = useState<IdCountry>(settings.country || 'AT');
  registerCommit(async () => {
    if (country !== (settings.country || 'AT')) await onSaveSettings({ ...settings, country });
  });

  return (
    <>
      <StepHeader
        title="Which country are you in?"
        body="This sets your real local emergency number and shapes a couple of ID questions coming up — an NHS number for the UK, medical aid for South Africa, that sort of thing."
      />
      <select className="field" value={country} onChange={(e) => setCountry(e.target.value as IdCountry)}>
        {COUNTRY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    </>
  );
}

/* --- Per-member: health essentials --- */

function MemberHealthStep({ member, onPatchMember, registerCommit }: {
  member: FamilyMember | undefined;
  onPatchMember: (memberId: string, patch: Partial<FamilyMember>) => Promise<void>;
  registerCommit: (fn: () => Promise<void>) => void;
}) {
  const [bloodGroup, setBloodGroup] = useState(member?.medical?.bloodGroup || '');
  const [allergies, setAllergies] = useState(member?.medical?.allergies || '');

  registerCommit(async () => {
    if (!member) return;
    if (bloodGroup === (member.medical?.bloodGroup || '') && allergies === (member.medical?.allergies || '')) return;
    await onPatchMember(member.id, { medical: { ...member.medical, bloodGroup: bloodGroup.trim() || undefined, allergies: allergies.trim() || undefined } });
  });

  if (!member) return null;

  return (
    <>
      <StepHeader
        title={`${member.name}'s blood group & allergies`}
        body="The two facts a paramedic or emergency room asks for first. Skip anything you don't know — plain text is fine."
      />
      <div className="space-y-3">
        <div>
          <label className="field-label">Blood group</label>
          <input autoFocus type="text" placeholder="e.g. O+, A-, AB" value={bloodGroup} onChange={(e) => setBloodGroup(e.target.value)} className="field uppercase placeholder:normal-case" />
        </div>
        <div>
          <label className="field-label">Allergies</label>
          <textarea rows={2} placeholder="e.g. Penicillin, peanuts, shellfish" value={allergies} onChange={(e) => setAllergies(e.target.value)} className="field font-sans" />
        </div>
      </div>
    </>
  );
}

/* --- Per-member: emergency contact --- */

function MemberEmergencyStep({ member, onPatchMember, registerCommit }: {
  member: FamilyMember | undefined;
  onPatchMember: (memberId: string, patch: Partial<FamilyMember>) => Promise<void>;
  registerCommit: (fn: () => Promise<void>) => void;
}) {
  const [name, setName] = useState(member?.emergencyContactName || '');
  const [phone, setPhone] = useState(member?.emergencyContactPhone || '');

  registerCommit(async () => {
    if (!member) return;
    if (name === (member.emergencyContactName || '') && phone === (member.emergencyContactPhone || '')) return;
    await onPatchMember(member.id, { emergencyContactName: name.trim() || undefined, emergencyContactPhone: phone.trim() || undefined });
  });

  if (!member) return null;

  return (
    <>
      <StepHeader
        title={`Who do we call about ${member.name}?`}
        body={`If something happens to ${member.name}, who should be phoned first?`}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="field-label">Name</label>
          <input autoFocus type="text" placeholder="e.g. Mom, Dad, Aunt Sipho" value={name} onChange={(e) => setName(e.target.value)} className="field" />
        </div>
        <div>
          <label className="field-label">Phone</label>
          <input type="tel" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} className="field" />
        </div>
      </div>
    </>
  );
}

/* --- Per-member: passport / ID --- */

function MemberIdStep({ member, country, onPatchMember, onAddDocument, registerCommit }: {
  member: FamilyMember | undefined;
  country: IdCountry;
  onPatchMember: (memberId: string, patch: Partial<FamilyMember>) => Promise<void>;
  onAddDocument: (memberId: string, doc: FamilyDocument) => Promise<void>;
  registerCommit: (fn: () => Promise<void>) => void;
}) {
  const existingPassport = member?.passports?.[0];
  const [pCountry, setPCountry] = useState(existingPassport?.country || '');
  const [pNumber, setPNumber] = useState(existingPassport?.number || '');
  const [pExpiry, setPExpiry] = useState(existingPassport?.expiryDate || '');
  const idField = COUNTRY_ID_FIELD[country];
  const [idValue, setIdValue] = useState((member?.identity?.[idField.key] as string) || '');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannedName, setScannedName] = useState<string | null>(null);

  registerCommit(async () => {
    if (!member) return;
    const patch: Partial<FamilyMember> = {};
    if (pNumber.trim() || pCountry.trim()) {
      const rec: PassportRecord = {
        id: existingPassport?.id || newId(),
        country: pCountry.trim(),
        number: pNumber.trim(),
        expiryDate: pExpiry || undefined,
      };
      patch.passports = existingPassport
        ? (member.passports || []).map(p => (p.id === rec.id ? rec : p))
        : [...(member.passports || []), rec];
    }
    if (idValue.trim() !== ((member.identity?.[idField.key] as string) || '')) {
      patch.identity = { ...(member.identity || {}), [idField.key]: idValue.trim() || undefined };
    }
    if (Object.keys(patch).length > 0) await onPatchMember(member.id, patch);
  });

  if (!member) return null;

  return (
    <>
      <StepHeader
        title={`Any passport or ID worth saving for ${member.name}?`}
        body="A photo is faster than typing, and it matters most right before it expires. Scan it, type the number, or both — whatever's quickest."
      />
      <button
        type="button"
        onClick={() => setScannerOpen(true)}
        className="btn-quiet w-full justify-center text-[13px] mb-3"
      >
        <Camera className="w-3.5 h-3.5" />
        <span>Scan a passport or ID</span>
      </button>
      {scannedName && (
        <p className="text-[12px] text-sage-700 flex items-center gap-1.5 mb-3 -mt-1.5">
          <Check className="w-3.5 h-3.5" /> Saved to {member.name}'s documents
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3">
        <input className="field" placeholder="Passport country" value={pCountry} onChange={(e) => setPCountry(e.target.value)} />
        <input className="field font-mono" placeholder="Passport number" value={pNumber} onChange={(e) => setPNumber(e.target.value)} />
      </div>
      <div className="mb-3">
        <label className="field-label">Passport expiry</label>
        <input type="date" className="field" value={pExpiry} onChange={(e) => setPExpiry(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{idField.label}</label>
        <input className="field font-mono" placeholder={idField.placeholder} value={idValue} onChange={(e) => setIdValue(e.target.value)} />
      </div>

      <DocumentScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onUse={(file: ScannedFile) => {
          void onAddDocument(member.id, {
            id: 'doc-' + Date.now().toString(),
            name: `${member.name}'s passport scan`,
            category: 'ID',
            fileType: file.type,
            fileName: file.name,
            fileSize: file.size,
            uploadedAt: new Date().toLocaleDateString('en-CA'),
            fileData: file.data,
          });
          setScannedName(file.name);
          setScannerOpen(false);
        }}
        title="Scan passport or ID"
        scanType="passport"
      />
    </>
  );
}

/* --- Family doctor --- */

function DoctorStep({ demo, registerCommit }: { demo: boolean; registerCommit: (fn: () => Promise<void>) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [practice, setPractice] = useState('');

  registerCommit(async () => {
    if (demo) return;
    if (!name.trim() && !phone.trim() && !practice.trim()) return;
    const provider: HealthcareProvider = {
      id: newId(),
      name: name.trim(),
      type: 'GP practice',
      practiceName: practice.trim() || undefined,
      phone: phone.trim() || undefined,
      isPrimary: true,
    };
    const info = (await loadFamilyInfo()) || { numbers: [], contacts: [], providers: [] };
    await saveFamilyInfo({ ...info, providers: [...(info.providers || []), provider] });
  });

  return (
    <>
      <StepHeader
        title="Who's your family's doctor?"
        body="Just the basics for now — you can add dentists, specialists and more later in Info."
      />
      <div className="space-y-2.5">
        <input autoFocus className="field" placeholder="Doctor or practice name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <input className="field" placeholder="Practice / clinic (optional)" value={practice} onChange={(e) => setPractice(e.target.value)} />
          <input className="field" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
    </>
  );
}

/* --- Household essentials --- */

function HouseholdStep({ demo, registerCommit }: { demo: boolean; registerCommit: (fn: () => Promise<void>) => void }) {
  const [address, setAddress] = useState('');
  const [wifiName, setWifiName] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [doorCode, setDoorCode] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (demo) { setLoaded(true); return; }
    let active = true;
    loadHousehold().then((h) => {
      if (!active) return;
      setAddress(h?.address || '');
      setWifiName(h?.wifiName || '');
      setWifiPassword(h?.wifiPassword || '');
      setDoorCode(h?.doorCode || '');
      setLoaded(true);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  registerCommit(async () => {
    if (demo) return;
    const existing = (await loadHousehold()) || EMPTY_HOUSEHOLD;
    await saveHousehold({ ...existing, address, wifiName, wifiPassword, doorCode });
  });

  return (
    <>
      <StepHeader
        title="The practical stuff — for a babysitter, a courier, or you at 2am"
        body="Your address and Wi-Fi details, so anyone looking after your place (or your family) isn't stuck."
      />
      {!loaded ? (
        <div className="py-6 flex justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-clay-500" />
        </div>
      ) : (
        <div className="space-y-2.5">
          <textarea className="field resize-none" rows={2} placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <input className="field" placeholder="Wi-Fi network name" value={wifiName} onChange={(e) => setWifiName(e.target.value)} />
            <input className="field font-mono" placeholder="Wi-Fi password" value={wifiPassword} onChange={(e) => setWifiPassword(e.target.value)} />
          </div>
          <input className="field font-mono" placeholder="Door code (optional)" value={doorCode} onChange={(e) => setDoorCode(e.target.value)} />
        </div>
      )}
    </>
  );
}
