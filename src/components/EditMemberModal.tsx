import React, { useState, useRef, useEffect } from 'react';
import {
  X, Sparkles, Camera, Upload, RefreshCcw, Save, Search, PartyPopper, Star, BellRing, BellOff, Trash2, BookOpen,
} from 'lucide-react';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import { FamilyMember, MemberRole, NameCelebration, NameMeaning, SurnameMeaning } from '../types';
import { listTimeZones } from '../utils/timeZone';
import { auth } from '../lib/firebase';
import { loadSpaceInfo, saveSuppressReligiousSuggestions, loadFamilyInfo, saveFamilyInfo } from '../utils/db';
import { motion, AnimatePresence } from 'motion/react';
import { AVATAR_COLORS, warmAvatarColor } from '../utils/avatarPalette';
import { compressImageToAvatar } from '../utils/imageCompress';
import { BUSINESS_ROLE_PRESETS } from '../utils/businessRoles';
import SheetGrabber from './SheetGrabber';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { isValidNameDay, formatNameDay } from '../utils/nameDay';
import { resolveCelebrations, suggestLocal, LEGACY_NAME_DAY_ID } from '../utils/nameCelebrations';
import NameCelebrationModal from './NameCelebrationModal';
import NameMeaningModal from './NameMeaningModal';
import { meaningsFor, foldMeanings, surnameKey, roleLabel, confidenceLabel } from '../utils/nameMeanings';
import { useFamilyCtx } from '../contexts/FamilyContext';

interface EditMemberModalProps {
  isOpen: boolean;
  member: FamilyMember | undefined;
  onClose: () => void;
  onSave: (updatedMember: FamilyMember) => void;
  /** True when editing a member of a business space — shows employee-flavored fields (e.g. start date). */
  isBusinessSpace?: boolean;
}

interface PlaceHit { label: string; lat: number; lon: number; timeZone: string | null }

/** A coordinate, or nothing. Blank, junk and out-of-range all mean nothing. */
function coordOrUndefined(raw: string, limit: number): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : undefined;
}

// Read once at module load — this is the platform's own tz database, so there
// is nothing to bundle and nothing to keep up to date.
const timeZoneOptions = listTimeZones();

export default function EditMemberModal({ isOpen, member, onClose, onSave, isBusinessSpace = false }: EditMemberModalProps) {
  useBodyScrollLock(isOpen && !!member);

  // Only for the family-wide religious-suggestion switch below — that endpoint
  // is admin-only, so a non-admin must not be shown a control for it.
  const { isAdmin } = useFamilyCtx();

  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [role, setRole] = useState<MemberRole>('Child');
  const [customRole, setCustomRole] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [nameDay, setNameDay] = useState('');       // 'MM-DD', free text while typing
  const [nameDayFeast, setNameDayFeast] = useState('');
  // Name Days & Name Celebrations — the successor of the pair above. Both are
  // edited in the same section: nameDay/nameDayFeast stay the legacy fact,
  // this array is everything confirmed since. Only committed to the member on
  // Save, same as every other field in this modal.
  const [nameCelebrations, setNameCelebrations] = useState<NameCelebration[]>([]);
  const [nameCelebrationDismissed, setNameCelebrationDismissed] = useState(false);
  const [showCelebrationModal, setShowCelebrationModal] = useState(false);
  // What this person's names MEAN — the other half of the name section. Given
  // and second names are this member's own and ride along on Save with every
  // other field. The FAMILY name is not theirs alone, so it lives once per
  // space in FamilyInfo.surnameMeanings and is written separately (see
  // utils/nameMeanings.ts for why the two stores exist).
  //
  // `surnameBaseline` is what was loaded, kept so Save can tell whether the
  // shared document needs writing at all — a member edit that never touched a
  // surname must not write to a document everyone shares.
  const [nameMeanings, setNameMeanings] = useState<NameMeaning[]>([]);
  const [surnameMeanings, setSurnameMeanings] = useState<SurnameMeaning[]>([]);
  const [surnameBaseline, setSurnameBaseline] = useState<SurnameMeaning[]>([]);
  const [showMeaningModal, setShowMeaningModal] = useState(false);
  const [meaningSaveError, setMeaningSaveError] = useState<string | null>(null);
  // Space-level "don't suggest religious celebrations" — read-only here (the
  // toggle itself lives in FamilySettings). Loaded once per open rather than
  // per keystroke since it cannot change while this modal is up. null = not
  // yet loaded, during which no suggestion is offered (fail closed): a false
  // default would briefly offer a saint's day to a family that switched
  // saint suggestions off.
  const [suppressReligiousSuggestions, setSuppressReligiousSuggestions] = useState<boolean | null>(null);
  const [birthTime, setBirthTime] = useState('');
  const [placeOfBirth, setPlaceOfBirth] = useState('');
  const [nationality, setNationality] = useState('');
  const [gender, setGender] = useState('');
  // Kept as strings so a half-typed "-33." doesn't get coerced to NaN mid-edit.
  const [birthTimeZone, setBirthTimeZone] = useState('');
  const [birthLatitude, setBirthLatitude] = useState('');
  const [birthLongitude, setBirthLongitude] = useState('');
  // Town search, so nobody has to go and find coordinates themselves.
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceHit[]>([]);
  const [placeSearching, setPlaceSearching] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placePicked, setPlacePicked] = useState<string | null>(null);
  const [birthHospital, setBirthHospital] = useState('');
  // Read by Emergency, Babysitter mode and the emergency card, and until now
  // writable ONLY by the AI or the one-time guided interview — there was no
  // field anywhere to type one. The readiness score surfaced that as a nudge
  // pointing at a screen that could not fix it.
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [startDate, setStartDate] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [employer, setEmployer] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [workPhone, setWorkPhone] = useState('');
  const [workAddress, setWorkAddress] = useState('');
  const [selectedColor, setSelectedColor] = useState(AVATAR_COLORS[0]);
  const [isOnline, setIsOnline] = useState(false);

  // Profile Image states
  const [avatarMode, setAvatarMode] = useState<'current' | 'color' | 'upload' | 'camera'>('current');
  const [uploadedBase64, setUploadedBase64] = useState<string>('');
  const [uploadFileName, setUploadFileName] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Initialize values when member changes
  useEffect(() => {
    if (member) {
      setName(member.name);
      setNickname(member.nickname || '');
      if (isBusinessSpace) {
        // Coerce a legacy/stray 'Child' (a family-only value that can't happen
        // in a business space going forward) rather than displaying it.
        const stored = member.role === 'Child' ? 'Employee' : member.role;
        if (BUSINESS_ROLE_PRESETS.includes(stored)) {
          setRole(stored);
          setCustomRole('');
        } else {
          setRole('Custom');
          setCustomRole(stored);
        }
      } else {
        setRole(member.role);
      }
      setBirthdate(member.birthdate || '');
      setNameDay(member.nameDay || '');
      setNameDayFeast(member.nameDayFeast || '');
      setNameCelebrations(member.nameCelebrations || []);
      setNameCelebrationDismissed(!!member.nameCelebrationDismissed);
      setNameMeanings(member.nameMeanings || []);
      setMeaningSaveError(null);
      setBirthTime(member.birthTime || '');
      setPlaceOfBirth(member.placeOfBirth || '');
      setNationality(member.nationality || '');
      setGender(member.gender || '');
      setBirthTimeZone(member.birthTimeZone || '');
      setBirthLatitude(member.birthLatitude !== undefined ? String(member.birthLatitude) : '');
      setBirthLongitude(member.birthLongitude !== undefined ? String(member.birthLongitude) : '');
      setPlaceQuery(member.placeOfBirth || '');
      setPlaceResults([]);
      setPlaceError(null);
      setPlacePicked(null);
      setBirthHospital(member.birthHospital || '');
      setEmergencyContactName(member.emergencyContactName || '');
      setEmergencyContactPhone(member.emergencyContactPhone || '');
      setTaxNumber(member.taxNumber || '');
      setStartDate(member.startDate || '');
      setAddress(member.address || '');
      setPhone(member.phone || '');
      setEmail(member.email || '');
      setEmployer(member.employer || '');
      setJobTitle(member.jobTitle || '');
      setWorkPhone(member.workPhone || '');
      setWorkAddress(member.workAddress || '');
      setSelectedColor(warmAvatarColor(member.avatarColor));
      setIsOnline(member.isOnline ?? false);
      if (member.avatarUrl) {
        setAvatarMode('current');
        setUploadedBase64(member.avatarUrl);
      } else {
        setAvatarMode('color');
        setUploadedBase64('');
      }
    }
  }, [member, isOpen, isBusinessSpace]);

  // families/{id}/info/info.suppressReligiousSuggestions. Read via
  // loadSpaceInfo (which is read-only by design — see its docstring); WRITTEN,
  // when an admin flips it from inside the celebration modal, through the same
  // server endpoint FamilySettings uses. No client ever writes that doc
  // directly.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    loadSpaceInfo().then((info) => {
      if (!cancelled) setSuppressReligiousSuggestions(!!info?.suppressReligiousSuggestions);
    });
    return () => { cancelled = true; };
  }, [isOpen]);

  // The celebration modal's "religious suggestions are off" message used to be
  // a dead end — it named the blocker and offered no way past it short of
  // abandoning the edit. Admins can now flip it from in there; the server
  // rejects everyone else, so non-admins get told who to ask instead (see
  // NameCelebrationModal's onChangeSuppressReligious). Throws are deliberate:
  // the modal shows the failure inline and leaves the switch as it was.
  const handleChangeSuppressReligious = async (suppress: boolean) => {
    await saveSuppressReligiousSuggestions(suppress);
    setSuppressReligiousSuggestions(suppress);
  };

  // Surname meanings, from the shared Important Info document. Read on open so
  // a name already researched by someone else shows up here without a second
  // AI call — a surname is one etymology however many people carry it.
  //
  // Loading also refreshes db.ts's merge base for that document, which is
  // exactly what the load-mutate-save writers there expect (see
  // saveReferenceDoc's docstring). The save below spreads what it re-loads
  // rather than rebuilding it: a key present in the base and missing from the
  // value reads as a DELETE.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    loadFamilyInfo().then((info) => {
      if (cancelled) return;
      const stored = info?.surnameMeanings || [];
      setSurnameMeanings(stored);
      setSurnameBaseline(stored);
    }).catch(() => { /* offline: the section still works, it just starts empty */ });
    return () => { cancelled = true; };
  }, [isOpen]);

  // One research call answers about the whole name, so one confirm splits its
  // results across both stores at once — foldMeanings decides which goes where
  // by the role the model assigned each part, never by position in the string
  // (a last token is not reliably a surname).
  const handleConfirmMeanings = (entries: NameMeaning[]) => {
    const { own, surnames } = foldMeanings(nameMeanings, surnameMeanings, entries);
    setNameMeanings(own);
    setSurnameMeanings(surnames);
    setMeaningSaveError(null);
  };

  // Removal is by token rather than by id because the caller cannot know which
  // of the two stores an entry came from — meaningsFor() merges them, and that
  // merged list is what the family sees and taps delete on.
  const handleRemoveMeaning = (token: string) => {
    const key = surnameKey(token);
    setNameMeanings((prev) => prev.filter((m) => surnameKey(m.token) !== key));
    setSurnameMeanings((prev) => prev.filter((s) => s.key !== key));
  };


  // Resolve a town to coordinates and a time zone. The search runs on our own
  // server (see /api/geocode-place) rather than from the browser, so the
  // birth-town query never leaves with the user's IP attached, and the time
  // zone comes from the COORDINATES rather than from a guess about the name.
  async function searchPlace() {
    const q = placeQuery.trim();
    if (q.length < 2) return;
    setPlaceSearching(true);
    setPlaceError(null);
    setPlaceResults([]);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Please sign in again.');
      const token = await user.getIdToken();
      const res = await fetch('/api/geocode-place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not search for that place.');
      if (!data.results?.length) {
        setPlaceError('No match — try adding the country, e.g. "Durban, South Africa".');
      }
      setPlaceResults(data.results || []);
    } catch (e) {
      setPlaceError(e instanceof Error ? e.message : 'Could not search for that place.');
    } finally {
      setPlaceSearching(false);
    }
  }

  function choosePlace(hit: PlaceHit) {
    setBirthLatitude(String(hit.lat));
    setBirthLongitude(String(hit.lon));
    if (hit.timeZone) setBirthTimeZone(hit.timeZone);
    // The first one or two parts of an OSM display name are the recognisable
    // bit ("Chatsworth, eThekwini"); the rest is administrative detail nobody
    // asked for.
    const short = hit.label.split(',').slice(0, 2).map((p) => p.trim()).join(', ');
    setPlacePicked(short);
    if (!placeOfBirth.trim()) setPlaceOfBirth(short);
    setPlaceResults([]);
  }

  // Belt-and-braces: stop camera when modal closes or component unmounts
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const startCamera = async () => {
    setIsCameraActive(true);
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 350 }, height: { ideal: 350 } },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error(err);
      setCameraError('Permission check or camera offline.');
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth || 350;
      canvas.height = videoRef.current.videoHeight || 350;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        stopCamera();
        setUploadFileName('snapshot.jpg');
        setAvatarMode('upload');
        compressImageToAvatar(dataUrl).then(setUploadedBase64);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        alert('Please select a valid image file formats.');
        return;
      }
      setUploadFileName(file.name);
      setAvatarMode('upload');
      const reader = new FileReader();
      reader.onloadend = async () => {
        if (typeof reader.result === 'string') {
          const small = await compressImageToAvatar(reader.result);
          setUploadedBase64(small);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleClearImage = () => {
    setUploadedBase64('');
    setUploadFileName('');
    setAvatarMode('color');
  };

  const handleCancelClose = () => {
    stopCamera();
    onClose();
  };

  // Name Days & Name Celebrations — everything below only touches local
  // state; nothing reaches the member record until Save, same as nameDay
  // above. The single-primary invariant is enforced HERE (demote every other
  // confirmed entry when one is set primary) rather than inside
  // NameCelebrationModal, so it holds no matter which of the modal's own
  // paths (local match, research, custom date) produced the new entry.
  // Everywhere a primary is demoted here its notify flag goes with it: only
  // the primary notifies by default (spec: "do not generate multiple annual
  // notifications by default"), and the modal's primary-choice screen
  // promises exactly that for the one not chosen. Leaving notify true on the
  // demoted entry produced two annual pushes the family never opted into.
  const handleConfirmCelebration = (celebration: NameCelebration) => {
    setNameCelebrations((prev) => {
      const rest = celebration.primary
        ? prev.map((c) => (c.primary ? { ...c, primary: false, notify: false } : c))
        : prev;
      return [...rest, celebration];
    });
    setNameCelebrationDismissed(false); // confirming an answer un-declines the question
    setShowCelebrationModal(false);
  };
  const handleDismissCelebration = () => setNameCelebrationDismissed(true);
  const handleMakePrimary = (id: string) =>
    setNameCelebrations((prev) => prev.map((c) => (
      c.id === id ? { ...c, primary: true, notify: true }
        : c.primary ? { ...c, primary: false, notify: false }
        : c
    )));
  // Demoting the current primary with nothing else promoted is deliberate:
  // resolveCelebrations() re-derives the legacy nameDay pair as primary the
  // moment no explicit entry claims it, so this is how a family switches back
  // to the Namenstag without deleting anything.
  const handleMakeAdditional = (id: string) =>
    setNameCelebrations((prev) => prev.map((c) => (c.id === id ? { ...c, primary: false, notify: false } : c)));
  const handleToggleNotify = (id: string) =>
    setNameCelebrations((prev) => prev.map((c) => (c.id === id ? { ...c, notify: !c.notify } : c)));
  const handleRemoveCelebration = (id: string) =>
    setNameCelebrations((prev) => prev.filter((c) => c.id !== id));

  const handleSaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !member) return;
    if (nameDay && !isValidNameDay(nameDay)) return; // inline error is already visible; don't save garbage

    // The family-name half of this section lives in a document everyone
    // shares, so it is written here rather than travelling with the member.
    // Only when it actually changed: a member edit that never opened the
    // meanings modal must not touch a shared document at all.
    if (JSON.stringify(surnameMeanings) !== JSON.stringify(surnameBaseline)) {
      try {
        // Re-loaded immediately before writing, and SPREAD — this is the
        // load-mutate-save contract saveFamilyInfo merges against. Naming the
        // keys instead would delete every key added since this file was
        // written.
        const info = (await loadFamilyInfo()) || { numbers: [], contacts: [], providers: [] };
        const ok = await saveFamilyInfo({ ...info, surnameMeanings });
        if (!ok) throw new Error('Could not save the family-name meanings.');
      } catch (err: any) {
        // Deliberately blocks the save and keeps the modal open: the rest of
        // this form is still in state and recoverable, but confirmed research
        // that is silently dropped is gone for good.
        setMeaningSaveError(err?.message ?? 'Could not save the family-name meanings. Check your connection and try again.');
        return;
      }
    }

    let finalAvatarUrl: string | undefined = undefined;
    if (avatarMode === 'current' || avatarMode === 'upload') {
      finalAvatarUrl = uploadedBase64 || undefined;
    }

    const finalRole = isBusinessSpace && role === 'Custom' ? (customRole.trim() || 'Employee') : role;

    const updated: FamilyMember = {
      ...member,
      name: name.trim(),
      nickname: nickname.trim() || undefined,
      role: finalRole,
      birthdate: birthdate || undefined,
      // A hand-typed date that no longer matches the suggestion it was picked
      // from doesn't carry that suggestion's feast label — better a blank
      // second line than a saint's day attached to the wrong date.
      nameDay: nameDay || undefined,
      nameDayFeast: nameDay && nameDay === member.nameDay ? member.nameDayFeast : (nameDayFeast || undefined),
      nameCelebrations: nameCelebrations.length ? nameCelebrations : undefined,
      nameCelebrationDismissed: nameCelebrationDismissed || undefined,
      nameMeanings: nameMeanings.length ? nameMeanings : undefined,
      birthTime: birthTime || undefined,
      placeOfBirth: placeOfBirth.trim() || undefined,
      nationality: nationality.trim() || undefined,
      gender: gender.trim() || undefined,
      birthTimeZone: birthTimeZone || undefined,
      // Only stored when it parses to a real coordinate — birthChart.ts treats
      // an out-of-range value as no place at all, so saving junk here would
      // just be a field that silently does nothing.
      birthLatitude: coordOrUndefined(birthLatitude, 90),
      birthLongitude: coordOrUndefined(birthLongitude, 180),
      birthHospital: birthHospital.trim() || undefined,
      emergencyContactName: emergencyContactName.trim() || undefined,
      emergencyContactPhone: emergencyContactPhone.trim() || undefined,
      taxNumber: taxNumber.trim() || undefined,
      startDate: startDate || undefined,
      address: address.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      employer: employer.trim() || undefined,
      jobTitle: jobTitle.trim() || undefined,
      workPhone: workPhone.trim() || undefined,
      workAddress: workAddress.trim() || undefined,
      avatarColor: selectedColor,
      avatarUrl: finalAvatarUrl,
      isOnline
    };

    onSave(updated);
    stopCamera();
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && member && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleCancelClose}
            className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm anim-fade"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            className="card relative w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-3xl p-6 z-10 anim-pop"
          >
            {/* Mobile grabber bar */}
            <SheetGrabber onClose={handleCancelClose} />

            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-cream-200">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-lg bg-clay-50 text-clay-600">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display text-xl font-semibold text-ink-900">Edit Profile Settings</h3>
                  <p className="text-[13px] font-semibold text-ink-500">Update name, contact details, address, theme color and photo.</p>
                </div>
              </div>
              <button
                onClick={handleCancelClose}
                className="p-1 text-ink-400 hover:text-ink-700 rounded-lg hover:bg-cream-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveSubmit} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Full name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Charlie"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="field"
                  />
                </div>
                <div>
                  <label className="field-label">Nickname</label>
                  <input
                    type="text"
                    placeholder="e.g. Charlie-bear"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    className="field"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="field-label">{isBusinessSpace ? 'Title' : 'Role'}</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as MemberRole)}
                    className="field"
                  >
                    {isBusinessSpace ? (
                      <>
                        {BUSINESS_ROLE_PRESETS.map((t) => <option key={t} value={t}>{t}</option>)}
                        <option value="Custom">Custom…</option>
                      </>
                    ) : (
                      <>
                        <option value="Child">Child</option>
                        <option value="Parent">Parent</option>
                        <option value="Grandparent">Grandparent</option>
                        <option value="Other">Other</option>
                      </>
                    )}
                  </select>
                </div>

                <div>
                  <label className="field-label">Birthdate</label>
                  <input
                    type="date"
                    value={birthdate}
                    onChange={(e) => setBirthdate(e.target.value)}
                    className="field"
                  />
                </div>
              </div>

              {/* Namenstag — family-only, like the Child role above. A business
                  space is a team, not a household; nobody expects a colleague's
                  saint's day to be tracked here. Free text rather than a picker:
                  most families type "19.03" or "March 19" faster than they'd
                  find it in a date control, and the parse only needs month+day. */}
              {!isBusinessSpace && (
                <div className="grid grid-cols-2 gap-4 items-end">
                  <div>
                    <label className="field-label">Name day (Namenstag)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="MM-DD, e.g. 03-19"
                      value={nameDay}
                      onChange={(e) => { setNameDay(e.target.value.trim()); setNameDayFeast(''); }}
                      className="field"
                    />
                  </div>
                  {(() => {
                    // suggestLocal, not suggestNameDay: this button writes the
                    // LEGACY pair, which has no field for WHICH name a day
                    // belongs to, so only an exact first-name match may be
                    // one-tapped here — a variant, second-name or nickname
                    // match needs the explained, confirmed flow behind "Find a
                    // name day or celebration" below. suggestLocal also
                    // honours the family's religious-suggestion switch and a
                    // recorded "no name celebration" answer, which the old
                    // lookup knew nothing about. Until the switch has loaded,
                    // offer nothing rather than something that may be
                    // switched off. (suggestLocal returns null once nameDay
                    // holds a valid date, so no self-suggestion check needed.)
                    const suggestion = suppressReligiousSuggestions === null
                      ? null
                      : suggestLocal(
                          { name, nickname, nameDay, nameDayFeast, nameCelebrations, nameCelebrationDismissed },
                          { suppressReligiousSuggestions },
                        );
                    if (!suggestion || suggestion.matchType !== 'exact') return <div />;
                    return (
                      <button
                        type="button"
                        onClick={() => { setNameDay(suggestion.date); setNameDayFeast(suggestion.feast); }}
                        className="text-[12.5px] font-semibold text-clay-600 hover:text-clay-700 cursor-pointer pb-2.5 text-left"
                      >
                        Use {formatNameDay(suggestion.date)} ({suggestion.feast})
                      </button>
                    );
                  })()}
                  {nameDay && !isValidNameDay(nameDay) && (
                    <p className="text-[12px] text-rosa-600 -mt-2 col-span-2">Use MM-DD, e.g. 03-19 for 19 March.</p>
                  )}
                </div>
              )}

              {/* Name Days & Name Celebrations — family-only, same reasoning as
                  the Namenstag block above. suggestLocal/resolveCelebrations
                  do the actual matching; this modal only opens the confirm
                  flow and shows what has already been confirmed. */}
              {!isBusinessSpace && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="field-label mb-0">Name celebrations</label>
                    <button
                      type="button"
                      onClick={() => setShowCelebrationModal(true)}
                      className="text-[12.5px] font-semibold text-clay-600 hover:text-clay-700 cursor-pointer inline-flex items-center gap-1"
                    >
                      <PartyPopper className="w-3.5 h-3.5" /> Find a name day or celebration
                    </button>
                  </div>

                  {(() => {
                    const resolved = resolveCelebrations({
                      name, nickname, nameDay, nameDayFeast, nameCelebrations, nameCelebrationDismissed,
                      // Server-resolved movable dates live on the member, not
                      // in the edited array — pass them through so movable
                      // rows show their resolved date here too.
                      nameCelebrationResolvedDates: member?.nameCelebrationResolvedDates,
                    });
                    const rows = [resolved.primary, ...resolved.additional].filter((c): c is NameCelebration => !!c);
                    if (rows.length === 0) return null;
                    return (
                      <div className="rounded-2xl border border-cream-200 divide-y divide-cream-100 overflow-hidden">
                        {rows.map((c) => {
                          const isLegacy = c.id === LEGACY_NAME_DAY_ID;
                          return (
                            <div key={c.id} className="flex items-center gap-2.5 p-3">
                              <span className={`chip shrink-0 ${c.kind === 'name_day' ? 'bg-sage-100 text-sage-700' : 'bg-honey-100 text-honey-800'}`}>
                                {c.kind === 'name_day' ? 'Name Day' : 'Name Celebration'}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-semibold text-ink-800 truncate">{c.title}</p>
                                <p className="text-[11.5px] text-ink-400 truncate">
                                  {c.dateType === 'fixed' ? formatNameDay(c.date) : 'moves each year'}
                                  {' · '}{c.primary ? 'Primary' : 'Additional'}
                                </p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {!c.primary && !isLegacy && (
                                  <button type="button" title="Make primary" onClick={() => handleMakePrimary(c.id)} className="p-1.5 rounded-lg text-ink-300 hover:text-clay-600 hover:bg-cream-100 cursor-pointer">
                                    <Star className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {c.primary && !isLegacy && (
                                  <button type="button" title="Make additional instead" onClick={() => handleMakeAdditional(c.id)} className="p-1.5 rounded-lg text-clay-500 hover:bg-cream-100 cursor-pointer">
                                    <Star className="w-3.5 h-3.5 fill-current" />
                                  </button>
                                )}
                                {c.primary && isLegacy && (
                                  <span className="p-1.5 text-clay-500" title="Primary — edit the Namenstag field above to change it">
                                    <Star className="w-3.5 h-3.5 fill-current" />
                                  </span>
                                )}
                                {!isLegacy && (
                                  <button
                                    type="button"
                                    title={c.notify ? 'Notifies every year' : 'Not notified'}
                                    onClick={() => handleToggleNotify(c.id)}
                                    className={`p-1.5 rounded-lg cursor-pointer hover:bg-cream-100 ${c.notify ? 'text-sage-600' : 'text-ink-300'}`}
                                  >
                                    {c.notify ? <BellRing className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
                                  </button>
                                )}
                                {!isLegacy && (
                                  <button type="button" title="Remove" onClick={() => handleRemoveCelebration(c.id)} className="p-1.5 rounded-lg text-ink-300 hover:text-rosa-600 hover:bg-cream-100 cursor-pointer">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* What the names mean. Family-only for the same reason as the
                  two blocks above: an employee record has no business holding
                  an etymology of its holder's family name. */}
              {!isBusinessSpace && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="field-label mb-0">What the names mean</label>
                    <button
                      type="button"
                      onClick={() => setShowMeaningModal(true)}
                      disabled={!name.trim()}
                      className="text-[12.5px] font-semibold text-clay-600 hover:text-clay-700 cursor-pointer inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <BookOpen className="w-3.5 h-3.5" /> Look up the meanings
                    </button>
                  </div>

                  {(() => {
                    // Built from the name as CURRENTLY TYPED, so a name being
                    // corrected in this session lists the parts it now has.
                    const rows = meaningsFor({ name, nameMeanings }, surnameMeanings);
                    if (rows.length === 0) return null;
                    return (
                      <div className="rounded-2xl border border-cream-200 divide-y divide-cream-100 overflow-hidden">
                        {rows.map((m) => (
                          <div key={m.id} className="flex items-start gap-2.5 p-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="text-[13px] font-semibold text-ink-800">{m.token}</p>
                                <span className="chip bg-cream-200 text-ink-500">{roleLabel(m.role)}</span>
                                {/* Never a bare meaning: the hedge is the point.
                                    'contested' takes the warning tint because a
                                    family repeating a disputed derivation as
                                    fact is the failure this guards against. */}
                                <span className={`chip ${m.confidence === 'established' ? 'bg-sage-100 text-sage-700' : m.confidence === 'contested' ? 'bg-honey-100 text-honey-800' : 'bg-cream-200 text-ink-600'}`}>
                                  {confidenceLabel(m.confidence)}
                                </span>
                              </div>
                              <p className="text-[12.5px] text-ink-600 mt-0.5">
                                {m.meaning}{m.origin ? ` · ${m.origin}` : ''}
                              </p>
                            </div>
                            <button
                              type="button"
                              title={m.role === 'family' ? 'Remove — this drops it for everyone with this family name' : 'Remove'}
                              onClick={() => handleRemoveMeaning(m.token)}
                              className="p-1.5 rounded-lg text-ink-300 hover:text-rosa-600 hover:bg-cream-100 cursor-pointer shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* Said out loud because this is reached from ONE person's
                      edit screen and the family-name row is not theirs alone —
                      the surrounding context implies the opposite. */}
                  {surnameMeanings.length > 0 && (
                    <p className="text-[11.5px] text-ink-400 leading-snug">
                      The family-name meaning is shared — everyone with that name sees it.
                    </p>
                  )}

                  {meaningSaveError && (
                    <p className="text-[12px] text-rosa-600 leading-snug">{meaningSaveError}</p>
                  )}
                </div>
              )}

              {isBusinessSpace && role === 'Custom' && (
                <input
                  type="text"
                  required
                  placeholder="e.g. Head Chef, Bookkeeper"
                  value={customRole}
                  onChange={(e) => setCustomRole(e.target.value)}
                  className="field"
                />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Time of birth <span className="normal-case text-ink-300 font-normal">· optional</span></label>
                  <input type="time" value={birthTime} onChange={(e) => setBirthTime(e.target.value)} className="field" />
                </div>
                <div>
                  <label className="field-label">Place of birth <span className="normal-case text-ink-300 font-normal">· optional</span></label>
                  <input type="text" placeholder="e.g. Vienna, Austria" value={placeOfBirth} onChange={(e) => setPlaceOfBirth(e.target.value)} className="field" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Nationality <span className="normal-case text-ink-300 font-normal">· optional</span></label>
                  <input type="text" placeholder="e.g. Austrian, South African" value={nationality} onChange={(e) => setNationality(e.target.value)} className="field" />
                </div>
                <div>
                  <label className="field-label">Gender <span className="normal-case text-ink-300 font-normal">· optional</span></label>
                  <input type="text" placeholder="e.g. Female, Male, Non-binary" value={gender} onChange={(e) => setGender(e.target.value)} className="field" />
                </div>
              </div>

              {/* Only the rising sign needs these, and only when the star-sign
                  card is switched on — so they stay tucked away rather than
                  making everyone fill in coordinates for a bit of fun. */}
              {birthTime && (
                <details className="rounded-2xl border border-cream-300 bg-cream-50 px-3.5 py-2.5">
                  <summary className="text-[13px] font-semibold text-ink-700 cursor-pointer">
                    Exact birth location <span className="font-normal text-ink-400">· for a rising sign</span>
                  </summary>
                  <div className="pt-3 space-y-3">
                    <p className="text-[12px] text-ink-500 leading-snug">
                      A rising sign changes every two hours and depends on where on Earth you were.
                      Search the birth town below and the rest fills itself in. Without it the card
                      simply says so rather than guessing.
                    </p>
                    <div>
                      <label className="field-label">Search for the birth town</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={placeQuery}
                          onChange={(e) => setPlaceQuery(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchPlace(); } }}
                          placeholder="e.g. Durban, South Africa"
                          className="field flex-1"
                        />
                        <button
                          type="button"
                          onClick={searchPlace}
                          disabled={placeSearching || placeQuery.trim().length < 2}
                          className="btn-quiet shrink-0 disabled:opacity-40"
                        >
                          {placeSearching ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                        </button>
                      </div>
                      {placeError && <p className="text-[12px] text-rosa-700 mt-1.5">{placeError}</p>}
                      {placeResults.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {placeResults.map((r, i) => (
                            <li key={`${r.lat},${r.lon},${i}`}>
                              <button
                                type="button"
                                onClick={() => choosePlace(r)}
                                className="w-full text-left rounded-xl border border-cream-300 hover:border-clay-400 hover:bg-clay-50 px-3 py-2 cursor-pointer transition-colors"
                              >
                                <span className="block text-[12.5px] text-ink-800 leading-snug">{r.label}</span>
                                <span className="block text-[11px] text-ink-400 tabular-nums">
                                  {r.lat.toFixed(3)}, {r.lon.toFixed(3)}{r.timeZone ? ` · ${r.timeZone}` : ''}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {placePicked && (
                        <p className="text-[12px] text-sage-700 mt-1.5">Using <b>{placePicked}</b> — change it above if that's the wrong one.</p>
                      )}
                    </div>

                    <div>
                      <label className="field-label">Time zone at birth</label>
                      <select value={birthTimeZone} onChange={(e) => setBirthTimeZone(e.target.value)} className="field">
                        <option value="">Not set</option>
                        {timeZoneOptions.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="field-label">Latitude</label>
                        <input
                          type="number" step="0.0001" min={-90} max={90} inputMode="decimal"
                          placeholder="48.2082"
                          value={birthLatitude}
                          onChange={(e) => setBirthLatitude(e.target.value)}
                          className="field"
                        />
                      </div>
                      <div>
                        <label className="field-label">Longitude</label>
                        <input
                          type="number" step="0.0001" min={-180} max={180} inputMode="decimal"
                          placeholder="16.3738"
                          value={birthLongitude}
                          onChange={(e) => setBirthLongitude(e.target.value)}
                          className="field"
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-ink-400 leading-snug">
                      Filled in by the search above. You can edit them by hand if you know the exact spot —
                      a few kilometres either way makes no difference to a rising sign.
                    </p>
                  </div>
                </details>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="field-label">Hospital / clinic <span className="normal-case text-ink-300 font-normal">· optional</span></label>
                  <input type="text" placeholder="e.g. Rudolfstiftung, Vienna" value={birthHospital} onChange={(e) => setBirthHospital(e.target.value)} className="field" />
                </div>
              </div>

              {/* Who to call. Deliberately here on Overview rather than buried in
                  a medical tab: it is the first thing a babysitter, a paramedic
                  or a school needs, and the app already shows it on the
                  emergency card and in Babysitter mode. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Emergency contact <span className="normal-case text-ink-300 font-normal">· who to call</span></label>
                  <input type="text" placeholder="e.g. Maria (mum)" value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} className="field" />
                </div>
                <div>
                  <label className="field-label">Their phone</label>
                  <input type="tel" inputMode="tel" placeholder="e.g. +43 660 1234567" value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} className="field" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className={isBusinessSpace ? '' : 'sm:col-span-2'}>
                  <label className="field-label">Tax / SSN number <span className="normal-case text-ink-300 font-normal">· optional</span></label>
                  <input type="text" placeholder="e.g. tax or social security number" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} className="field" />
                </div>
                {isBusinessSpace && (
                  <div>
                    <label className="field-label">Start date <span className="normal-case text-ink-300 font-normal">· optional</span></label>
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="field" />
                    <p className="text-[11px] text-ink-400 mt-1">e.g. when they joined the business</p>
                  </div>
                )}
              </div>

              {/* Contact & address — visible to the whole family. Members can live at different addresses. */}
              <div>
                <label className="field-label">Address</label>
                <input
                  type="text"
                  placeholder="Street, city, postcode"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="field"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Phone</label>
                  <input
                    type="tel"
                    placeholder="e.g. +43 660 1234567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="field"
                  />
                </div>
                <div>
                  <label className="field-label">Email</label>
                  <input
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="field"
                  />
                </div>
              </div>

              {/* Employer / workplace — useful in an emergency (who to call, where someone works). */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Employer</label>
                  <input
                    type="text"
                    placeholder="e.g. Acme GmbH"
                    value={employer}
                    onChange={(e) => setEmployer(e.target.value)}
                    className="field"
                  />
                </div>
                <div>
                  <label className="field-label">Job title</label>
                  <input
                    type="text"
                    placeholder="e.g. Software Engineer"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    className="field"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Work phone</label>
                  <input
                    type="tel"
                    placeholder="e.g. +43 1 2345678"
                    value={workPhone}
                    onChange={(e) => setWorkPhone(e.target.value)}
                    className="field"
                  />
                </div>
                <div>
                  <label className="field-label">Work address</label>
                  <input
                    type="text"
                    placeholder="Street, city, postcode"
                    value={workAddress}
                    onChange={(e) => setWorkAddress(e.target.value)}
                    className="field"
                  />
                </div>
              </div>

              {/* Online Status Toggle */}
              <div className="bg-sage-50 border border-sage-100 rounded-2xl p-3 flex items-center justify-between">
                <div>
                  <h4 className="text-[13px] font-semibold text-ink-800">Online Status</h4>
                  <p className="text-[13px] font-semibold text-ink-500">Render as live and active in directory.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isOnline}
                    onChange={(e) => setIsOnline(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-cream-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-cream-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sage-500"></div>
                </label>
              </div>

              {/* Profile Avatar Selection Section */}
              <div className="space-y-2.5">
                <label className="field-label">Profile Representation / Photo</label>

                {/* Mode Selector Tabs */}
                <div className="flex bg-cream-100 p-1 rounded-xl select-none border border-cream-300">
                  <button
                    type="button"
                    onClick={() => { stopCamera(); setAvatarMode(uploadedBase64 ? 'current' : 'color'); }}
                    className={`flex-1 py-1.5 text-[13px] font-semibold rounded-lg transition-all text-center ${
                      avatarMode === 'current' || (avatarMode === 'color' && !uploadedBase64)
                        ? 'bg-white text-ink-900 shadow-soft'
                        : 'text-ink-500 hover:text-ink-800'
                    }`}
                  >
                    {uploadedBase64 ? 'Current Portrait' : 'Initials'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { stopCamera(); setAvatarMode('upload'); }}
                    className={`flex-1 py-1.5 text-[13px] font-semibold rounded-lg transition-all text-center flex items-center justify-center gap-1 ${
                      avatarMode === 'upload'
                        ? 'bg-white text-ink-900 shadow-soft'
                        : 'text-ink-500 hover:text-ink-800'
                    }`}
                  >
                    <Upload className="w-3 h-3" />
                    Upload Image
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAvatarMode('camera'); startCamera(); }}
                    className={`flex-1 py-1.5 text-[13px] font-semibold rounded-lg transition-all text-center flex items-center justify-center gap-1 ${
                      avatarMode === 'camera'
                        ? 'bg-white text-ink-900 shadow-soft'
                        : 'text-ink-500 hover:text-ink-800'
                    }`}
                  >
                    <Camera className="w-3 h-3" />
                    Take Snapshot
                  </button>
                </div>

                {/* Case 1: Colors & Initials */}
                {avatarMode === 'color' && (
                  <div className="p-3 bg-cream-50 border border-cream-300 rounded-2xl space-y-2">
                    <p className="section-label">Select color palette</p>
                    <div className="flex items-center flex-wrap gap-2">
                      {AVATAR_COLORS.map((colorClass) => (
                        <button
                          key={colorClass}
                          type="button"
                          onClick={() => setSelectedColor(colorClass)}
                          className={`relative w-8 h-8 rounded-xl ${colorClass} transition-transform hover:scale-105 focus:outline-none ${
                            selectedColor === colorClass
                              ? 'ring-2 ring-ink-900 ring-offset-2 ring-offset-white'
                              : ''
                          }`}
                        >
                          {selectedColor === colorClass && (
                            <span className="absolute inset-0 flex items-center justify-center">
                              <Sparkles className="w-4 h-4 text-white drop-shadow-sm" />
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Case 1.1: Current Portrait Loaded */}
                {avatarMode === 'current' && (
                  <div className="p-3 bg-cream-50 border border-cream-300 rounded-2xl flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl overflow-hidden border border-cream-300 bg-white shadow-soft">
                        <img src={uploadedBase64} alt="Avatar profile direct view" className="w-full h-full object-cover" />
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-ink-800">Has Custom Photo</p>
                        <p className="text-[13px] font-semibold text-ink-500">Saved to this profile.</p>
                      </div>
                    </div>
                    <ConfirmDeleteButton
                      onConfirm={handleClearImage}
                      ariaLabel="Remove this photo and use a standard color instead"
                      confirm={false}
                    />
                  </div>
                )}

                {/* Case 2: Upload File Image */}
                {avatarMode === 'upload' && (
                  <div className="p-4 bg-cream-100 border border-cream-300 rounded-2xl space-y-3">
                    <div className="flex items-center gap-3">
                      {uploadedBase64 ? (
                        <div className="w-12 h-12 rounded-xl border border-cream-300 overflow-hidden shrink-0 bg-white shadow-soft">
                          <img src={uploadedBase64} alt="Avatar profile snapshot" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className={`w-12 h-12 rounded-xl ${warmAvatarColor(selectedColor)} text-white font-bold text-lg flex items-center justify-center shrink-0 uppercase shadow-soft`}>
                          {name.trim() ? name.trim().charAt(0) : '?'}
                        </div>
                      )}
                      <div className="space-y-1">
                        <label className="inline-flex items-center gap-1 px-3 py-1.5 bg-dusk-50 text-dusk-700 hover:bg-dusk-100/80 rounded-lg text-[13px] font-semibold cursor-pointer transition-all border border-dusk-200">
                          <Upload className="w-3 h-3" />
                          <span>Choose New Image</span>
                          <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                        </label>
                        <p className="text-[13px] font-semibold text-ink-400 truncate max-w-[200px]">
                          {uploadFileName || 'No new image chosen.'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Case 3: Live Camera Snapshot */}
                {avatarMode === 'camera' && (
                  <div className="p-4 bg-cream-100 border border-cream-300 rounded-2xl space-y-3">
                    {isCameraActive ? (
                      <div className="space-y-2.5">
                        <div className="aspect-square w-full max-w-[200px] mx-auto rounded-2xl overflow-hidden bg-ink-900 border border-cream-300 relative">
                          <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            className="w-full h-full object-cover scale-x-[-1]"
                          />
                          <div className="absolute inset-0 border border-white/10 pointer-events-none rounded-2xl"></div>
                        </div>
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={capturePhoto}
                            className="btn-danger flex items-center gap-1"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            <span>Capture snap</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4 bg-cream-100 border border-dashed border-cream-300 rounded-2xl">
                        {cameraError ? (
                          <div className="space-y-2 px-3">
                            <p className="text-[13px] font-semibold text-rosa-700">{cameraError}</p>
                            <button
                              type="button"
                              onClick={startCamera}
                              className="btn-quiet inline-flex items-center gap-1.5"
                            >
                              <RefreshCcw className="w-3 h-3" /> Wait &amp; Retry
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {uploadedBase64 ? (
                              <div className="w-16 h-16 rounded-2xl border border-cream-300 overflow-hidden mx-auto bg-white shadow-soft">
                                <img src={uploadedBase64} alt="Captured portrait avatar" className="w-full h-full object-cover" />
                              </div>
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-dusk-100 text-dusk-500 flex items-center justify-center mx-auto">
                                <Camera className="w-5 h-5" />
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={startCamera}
                              className="btn-quiet"
                            >
                              Activate Stream / webcam
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-cream-200">
                <button
                  type="button"
                  onClick={handleCancelClose}
                  className="btn-quiet"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                >
                  <Save className="w-4 h-4" />
                  Save Changes
                </button>
              </div>
            </form>
          </motion.div>

          <NameCelebrationModal
            open={showCelebrationModal}
            displayName={name}
            nickname={nickname}
            existing={resolveCelebrations({
              name, nickname, nameDay, nameDayFeast, nameCelebrations, nameCelebrationDismissed,
              nameCelebrationResolvedDates: member?.nameCelebrationResolvedDates,
            })}
            dismissed={nameCelebrationDismissed}
            // Fail closed while the family setting is still loading: treating
            // "unknown" as suppressed only delays a saint's-day suggestion by
            // a moment; treating it as allowed shows one to a family that
            // switched them off.
            suppressReligiousSuggestions={suppressReligiousSuggestions ?? true}
            // Only handed over to an admin: /api/set-suggestion-prefs is
            // admin-only, so passing this to anyone else would draw a button
            // that always 403s. Absent = the modal says who to ask instead.
            onChangeSuppressReligious={isAdmin ? handleChangeSuppressReligious : undefined}
            onConfirm={handleConfirmCelebration}
            onDismiss={handleDismissCelebration}
            onClose={() => setShowCelebrationModal(false)}
          />

          <NameMeaningModal
            open={showMeaningModal}
            displayName={name}
            // Same merged view the section above renders, so what the modal
            // calls "already kept" is exactly what the form shows.
            existing={meaningsFor({ name, nameMeanings }, surnameMeanings)}
            onConfirm={handleConfirmMeanings}
            onRemove={handleRemoveMeaning}
            onClose={() => setShowMeaningModal(false)}
          />
        </div>
      )}
    </AnimatePresence>
  );
}
