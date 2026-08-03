import React, { useState, useRef, useEffect } from 'react';
import { X, Settings, Users, Upload, Save, Compass, ListChecks, RefreshCw, Loader2, Check } from 'lucide-react';
import { checkForUpdate, applyUpdate } from '../utils/appUpdate';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import { HubSettings, IdCountry } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { compressImageToAvatar } from '../utils/imageCompress';
import LanguageSelector from './LanguageSelector';
import PushOptInCard from './PushOptInCard';
import SheetGrabber from './SheetGrabber';
import TextSizeControl from './TextSizeControl';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

export const COUNTRY_OPTIONS: { value: IdCountry; label: string }[] = [
  { value: 'AT', label: 'Austria' },
  { value: 'ZA', label: 'South Africa' },
  { value: 'UK', label: 'United Kingdom' },
  { value: 'US', label: 'United States' },
  { value: 'other', label: 'Other / generic' },
];

interface HubSettingsModalProps {
  isOpen: boolean;
  settings: HubSettings;
  isBusinessSpace?: boolean;
  onClose: () => void;
  onSave: (s: HubSettings) => void;
  /** Runs the first-run tour again, on demand — "replayable from somewhere sensible" means here, since (unlike admin-only Family Settings) every signed-in member can open this modal. Omit to hide the row (e.g. no caller wired up yet). */
  onReplayTour?: () => void;
  /** Reopens the guided setup interview (FamilyInterview.tsx) from the start — "reachable again from settings after completion" per its brief. Omit to hide the row (business spaces, or a caller with no write access). */
  onOpenInterview?: () => void;
}

// Falls back to 'dev' exactly as UpdateBanner does, so a local build reads as
// local rather than as a nameless release.
const APP_LABEL =
  typeof __APP_LABEL__ !== 'undefined' && __APP_LABEL__ ? __APP_LABEL__ : 'dev build';

export default function HubSettingsModal({ isOpen, settings, isBusinessSpace, onClose, onSave, onReplayTour, onOpenInterview }: HubSettingsModalProps) {
  useBodyScrollLock(isOpen);

  const [hubName, setHubName] = useState('');
  const [photo, setPhoto] = useState<string>('');
  const [uploadFileName, setUploadFileName] = useState('');
  const [nameDisplay, setNameDisplay] = useState<'real' | 'nick' | 'both'>('both');
  const [astrology, setAstrology] = useState(false);
  const [country, setCountry] = useState<IdCountry>('AT');
  const [celebrationsEnabled, setCelebrationsEnabled] = useState(true);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Seed local state whenever the modal opens or settings change
  useEffect(() => {
    if (isOpen) {
      setHubName(settings.hubName || '');
      setPhoto(settings.familyPhotoUrl || '');
      setNameDisplay(settings.nameDisplay || 'both');
      setAstrology(settings.astrology === true);
      setCountry(settings.country || 'AT');
      setCelebrationsEnabled(settings.celebrationsEnabled !== false);
      setUploadFileName('');
    }
  }, [isOpen, settings]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select a valid image file.');
      return;
    }
    setUploadFileName(file.name);
    const reader = new FileReader();
    reader.onloadend = async () => {
      if (typeof reader.result === 'string') {
        const small = await compressImageToAvatar(reader.result);
        setPhoto(small);
      }
    };
    reader.readAsDataURL(file);
    // Reset so the same file can be re-selected if needed
    e.target.value = '';
  };

  const handleRemovePhoto = () => {
    setPhoto('');
    setUploadFileName('');
  };

  const handleSave = () => {
    onSave({
      hubName: hubName.trim() || undefined,
      familyPhotoUrl: photo || undefined,
      nameDisplay,
      astrology,
      country,
      celebrationsEnabled,
    });
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm anim-fade"
          />

          {/* Modal card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            className="card relative w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-3xl p-6 z-10 anim-pop"
          >
            {/* Mobile grabber bar */}
            <SheetGrabber onClose={onClose} />

            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-cream-200">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-lg bg-clay-50 text-clay-600">
                  <Settings className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display text-xl font-semibold text-ink-900">{isBusinessSpace ? 'Business settings' : 'Hub settings'}</h3>
                  <p className="text-[13px] font-semibold text-ink-500">
                    {isBusinessSpace ? 'Name your business and add a logo or photo.' : 'Name your family hub and add a family photo.'}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1 text-ink-400 hover:text-ink-700 rounded-lg hover:bg-cream-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <div className="mt-4 space-y-5">
              {/* App language — a per-device preference, so it lives here (out of the
                  header) and is reachable by every family member. */}
              <div>
                <label className="field-label">App language</label>
                <LanguageSelector />
              </div>

              {/* Text size — same class of thing as language: a per-device
                  display preference, not a household setting. */}
              <TextSizeControl />

              {/* Redo the guided setup interview — reachable any time it's
                  wired up, not just on day one. See FamilyInterview.tsx. */}
              {onOpenInterview && (
                <button
                  type="button"
                  onClick={onOpenInterview}
                  className="btn-quiet w-full justify-center text-[13px]"
                >
                  <ListChecks className="w-3.5 h-3.5" />
                  <span>Redo the guided setup</span>
                </button>
              )}

              {/* Replay the first-run tour — reachable by anyone, any time,
                  not just on day one. See FirstRunTour.tsx. */}
              {onReplayTour && (
                <button
                  type="button"
                  onClick={onReplayTour}
                  className="btn-quiet w-full justify-center text-[13px]"
                >
                  <Compass className="w-3.5 h-3.5" />
                  <span>Replay the welcome tour</span>
                </button>
              )}

              {/* Hub / business name field */}
              <div>
                <label className="field-label">{isBusinessSpace ? 'Business name' : 'Hub name'}</label>
                <input
                  type="text"
                  placeholder={isBusinessSpace ? 'My Business' : 'Family Hub'}
                  value={hubName}
                  onChange={(e) => setHubName(e.target.value)}
                  className="field"
                />
              </div>

              {/* Country — picks the right ID document format below (e-Card/
                  Aufenthaltstitel for Austria, SA ID/SARS for South Africa) */}
              <div>
                <label className="field-label">Country</label>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value as IdCountry)}
                  className="field"
                >
                  {COUNTRY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-[12px] text-ink-400 mt-1.5">Sets which ID document fields show under ID &amp; Passports.</p>
              </div>

              {/* How names show */}
              <div>
                <label className="field-label">Show member names as</label>
                <div className="flex bg-cream-100 p-1 rounded-xl border border-cream-300 select-none">
                  {([
                    { id: 'real', label: 'Real name' },
                    { id: 'nick', label: 'Nickname' },
                    { id: 'both', label: 'Both' },
                  ] as const).map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setNameDisplay(opt.id)}
                      className={`flex-1 py-1.5 text-[13px] font-semibold rounded-lg transition-all ${
                        nameDisplay === opt.id ? 'bg-white text-ink-900 shadow-soft' : 'text-ink-500 hover:text-ink-800'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[12px] text-ink-400 mt-1.5">Just for fun — e.g. show “Mia ‘Mimi’” or only “Mimi”.</p>
              </div>

              {/* Astrology (opt-in, off by default) */}
              <div>
                <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
                  <span>
                    <span className="field-label" style={{ marginBottom: 0 }}>Star signs <span className="normal-case text-ink-300 font-normal">· just for fun</span></span>
                    <span className="block text-[12px] text-ink-400 mt-0.5">Shows a light-hearted star sign on each profile with a birthday. Off by default — not everyone’s into it.</span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={astrology}
                    onClick={() => setAstrology(v => !v)}
                    className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${astrology ? 'bg-clay-500' : 'bg-cream-300'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-soft transition-transform ${astrology ? 'translate-x-5' : ''}`} />
                  </button>
                </label>
              </div>

              {/* Celebrations — per-space kill switch for the confetti overlay
                  (birthdays, and in a business space, work/founding/milestone
                  anniversaries) and its "needs attention" nudges. On by
                  default. A single person who's fine with celebrations
                  generally but wants out personally can instead use "No fuss,
                  please" on their own profile. */}
              <div>
                <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
                  <span>
                    <span className="field-label" style={{ marginBottom: 0 }}>Celebrations</span>
                    <span className="block text-[12px] text-ink-400 mt-0.5">
                      {isBusinessSpace
                        ? 'The confetti moment for birthdays, work anniversaries and business milestones. Turn off if your team would rather skip the fuss.'
                        : 'The confetti moment for birthdays. On by default.'}
                    </span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={celebrationsEnabled}
                    onClick={() => setCelebrationsEnabled(v => !v)}
                    className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${celebrationsEnabled ? 'bg-clay-500' : 'bg-cream-300'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-soft transition-transform ${celebrationsEnabled ? 'translate-x-5' : ''}`} />
                  </button>
                </label>
              </div>

              {/* Family / business photo field */}
              <div className="space-y-2.5">
                <label className="field-label">{isBusinessSpace ? 'Business photo' : 'Family photo'}</label>

                {photo ? (
                  /* Preview with remove button */
                  <div className="p-3 bg-cream-50 border border-cream-300 rounded-2xl flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-14 h-14 rounded-2xl overflow-hidden border border-cream-300 bg-white shadow-soft shrink-0">
                        <img
                          src={photo}
                          alt={isBusinessSpace ? 'Business photo preview' : 'Family photo preview'}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-ink-800">{isBusinessSpace ? 'Business photo set' : 'Family photo set'}</p>
                        <p className="text-[13px] font-semibold text-ink-400 truncate max-w-[180px]">
                          {uploadFileName || 'Stored locally.'}
                        </p>
                        <label className="inline-flex items-center gap-1 mt-1 text-[13px] font-semibold text-dusk-700 hover:text-dusk-500 cursor-pointer transition-colors">
                          <Upload className="w-3 h-3" />
                          <span>Replace photo</span>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleFileChange}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>
                    <ConfirmDeleteButton
                      onConfirm={handleRemovePhoto}
                      ariaLabel={isBusinessSpace ? 'Remove business photo' : 'Remove family photo'}
                      confirm={false}
                      className="shrink-0"
                    />
                  </div>
                ) : (
                  /* Placeholder / upload prompt */
                  <div className="p-4 bg-cream-50 border border-dashed border-cream-300 rounded-2xl flex flex-col items-center gap-3">
                    <div className="w-14 h-14 rounded-2xl bg-clay-50 text-clay-600 flex items-center justify-center">
                      <Users className="w-6 h-6" />
                    </div>
                    <div className="text-center space-y-1">
                      <p className="text-[13px] font-semibold text-ink-600">{isBusinessSpace ? 'No business photo yet' : 'No family photo yet'}</p>
                      <p className="text-[13px] font-semibold text-ink-400">{isBusinessSpace ? 'A shared photo or logo shown across the hub.' : 'A shared photo shown across the hub.'}</p>
                    </div>
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-dusk-50 text-dusk-700 hover:bg-dusk-100/80 rounded-lg text-[13px] font-semibold cursor-pointer transition-all border border-dusk-200">
                      <Upload className="w-3 h-3" />
                      <span>Upload photo</span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                    </label>
                  </div>
                )}
              </div>

              {/* Birthday reminders (Web Push) — everyone (not just admins) can
                  reach this modal, and enabling push is a per-device thing, so it
                  belongs here rather than in the admin-only Family Settings panel.
                  Self-contained: gates itself on install/eligibility. */}
              <PushOptInCard />
            </div>

            {/* Footer actions */}
            <div className="flex flex-wrap items-center justify-end gap-3 pt-4 mt-4 border-t border-cream-200">
              {/* Which build am I actually running? Until now nothing in the app
                  answered that: the build stamp existed but was read only by
                  UpdateBanner, so "is my update live?" could only be settled by
                  hunting for a feature and guessing. A user on a stale tab and a
                  user hitting a genuine bug look identical without it, and the
                  first thing to establish in any support conversation is which
                  one you are talking to. Deliberately plain and unclickable —
                  it is a fact to read out, not a control. */}
              <span className="mr-auto flex flex-col gap-0.5 min-w-0">
                <span className="text-[12px] text-ink-400 tabular-nums select-text">
                  Teluva {APP_LABEL}
                </span>
                <UpdateCheckRow />
              </span>
              <button
                type="button"
                onClick={onClose}
                className="btn-quiet"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="btn-primary"
              >
                <Save className="w-4 h-4" />
                Save
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/**
 * "Check for updates" — the answer to a question the update BANNER structurally
 * cannot answer.
 *
 * The banner only fires when the app is open as a deploy lands. Anyone who
 * closes and reopens the app gets the new build silently on reopen, so the
 * banner correctly never appears — and they are left with no way to tell an
 * update apart from a stale tab, which is exactly how a fixed bug gets reported
 * as still broken. This asks on demand, with the same comparison.
 *
 * Four states, and the fourth is the one that matters: `checkForUpdate` returns
 * null when it could not reach the server, and that is reported as "couldn't
 * check", never as "up to date". Telling someone they are current when we do
 * not know is the failure this control exists to prevent.
 */
function UpdateCheckRow() {
  const [state, setState] = useState<'idle' | 'checking' | 'current' | 'stale' | 'unknown'>('idle');
  const [newLabel, setNewLabel] = useState('');

  const run = async () => {
    setState('checking');
    const res = await checkForUpdate();
    if (!res) { setState('unknown'); return; }
    if (res.updateAvailable) {
      setNewLabel(res.deployed.label);
      setState('stale');
    } else {
      setState('current');
    }
  };

  if (state === 'stale') {
    return (
      <button
        type="button"
        onClick={() => void applyUpdate()}
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-clay-600 hover:text-clay-700 cursor-pointer"
      >
        <RefreshCw className="w-3 h-3" />
        {newLabel ? `${newLabel} is ready — update now` : 'An update is ready — update now'}
      </button>
    );
  }

  if (state === 'current') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-sage-600">
        <Check className="w-3 h-3" /> You&rsquo;re on the latest version
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={state === 'checking'}
      className="inline-flex items-center gap-1.5 text-[12px] text-ink-500 hover:text-ink-800 cursor-pointer disabled:cursor-wait self-start"
    >
      {state === 'checking'
        ? <><Loader2 className="w-3 h-3 animate-spin" /> Checking…</>
        : state === 'unknown'
          ? <><RefreshCw className="w-3 h-3" /> Couldn&rsquo;t check — tap to try again</>
          : <><RefreshCw className="w-3 h-3" /> Check for updates</>}
    </button>
  );
}
