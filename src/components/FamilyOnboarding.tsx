import React, { useState, useEffect } from 'react';
import { CalendarDays, Heart, Home, Key, Loader2, ShieldCheck } from 'lucide-react';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { createFamily, joinFamily } from '../utils/db';
import { auth, logout } from '../lib/firebase';
import LanguageSelector from './LanguageSelector';
import { useAppearance } from '../contexts/AppearanceContext';

type Mode = 'idle' | 'create' | 'join';
type FirstJob = 'week' | 'vault' | 'story';

// Extract join code from URL: /join/{code}
function codeFromUrl(): string {
  const match = window.location.pathname.match(/^\/join\/(.+)/);
  return match ? match[1].trim() : '';
}

/**
 * Shown when a user is signed in but has no family assigned yet.
 * Lets them start a brand-new family or join an existing one with a code.
 * If the URL is /join/{code}, the join form is pre-filled automatically.
 */
export default function FamilyOnboarding() {
  const { email } = useFamilyCtx();
  const { interfacePreference } = useAppearance();
  const emberMode = interfacePreference === 'ember';
  const displayName = auth.currentUser?.displayName ?? email ?? 'there';
  const firstName = displayName.split(' ')[0];

  const urlCode = codeFromUrl();
  const [mode, setMode] = useState<Mode>(urlCode ? 'join' : 'idle');
  const [familyName, setFamilyName] = useState('');
  const [joinCode, setJoinCode] = useState(urlCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstJob, setFirstJob] = useState<FirstJob>('week');

  // Auto-submit if we landed here via a /join/{code} link
  useEffect(() => {
    if (urlCode) {
      handleJoinDirect(urlCode);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleJoinDirect(code: string) {
    setBusy(true);
    setError(null);
    try {
      await joinFamily(code);
      window.location.href = '/';
    } catch (err: any) {
      setError(err?.message ?? 'Invalid link — ask your admin to share a new one.');
      setBusy(false);
    }
  }

  function resetError() { setError(null); }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = familyName.trim();
    if (!name) { setError('Please enter a family name'); return; }
    setBusy(true);
    setError(null);
    try {
      await createFamily(name);
      try { localStorage.setItem('teluva.firstJob', firstJob); } catch { /* private browsing */ }
      window.location.reload();
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim();
    if (!code) { setError('Please enter a join code'); return; }
    setBusy(true);
    setError(null);
    try {
      await joinFamily(code);
      window.location.reload();
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className={`min-h-screen bg-cream-50 flex items-center justify-center p-4 ${emberMode ? 'ember-onboarding' : ''}`}>
      {emberMode && <aside className="ember-onboarding-story">
        <div className="ember-onboarding-brand"><span>T</span><b>Teluva</b></div>
        <div className="ember-onboarding-orbit" aria-hidden="true"><i /><i /><span>♥</span></div>
        <h1>Keep the family<br /><em>close to hand.</em></h1>
        <p>A private place for what matters now—and what should never be lost.</p>
        <div className="ember-onboarding-proof"><ShieldCheck className="h-4 w-4" /><span><b>Private by design</b><small>Exportable · permission-aware · no ads</small></span></div>
      </aside>}
      <div className={`card max-w-md w-full p-5 sm:p-8 space-y-6 ${emberMode ? 'ember-onboarding-card' : ''}`}>
        {/* Pick app language up front (also lives in Settings later) */}
        <div className="flex justify-center">
          <LanguageSelector />
        </div>

        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="font-display text-3xl text-ink-900">Welcome, {firstName}</h1>
          <p className="text-ink-400 text-sm">
            Signed in as <span className="text-ink-700">{email}</span>.
            Set up your family vault to get started.
          </p>
        </div>

        {/* Idle: two options */}
        {mode === 'idle' && (
          <div className="space-y-3">
            {emberMode && <div className="ember-first-job">
              <span className="pulse-eyebrow">Let’s begin with this week</span>
              <h2>What would feel useful first?</h2>
              <p>Choose one family job. Teluva will grow from that first useful place.</p>
              {([
                { id: 'week', label: 'See our week clearly', note: 'Bring together people, plans and preparation', icon: CalendarDays },
                { id: 'vault', label: 'Protect important records', note: 'Start a private family vault', icon: ShieldCheck },
                { id: 'story', label: 'Keep our story', note: 'Save a memory worth returning to', icon: Heart },
              ] as const).map(({ id, label, note, icon: Icon }) => (
                <button key={id} type="button" onClick={() => setFirstJob(id)} className={firstJob === id ? 'is-selected' : ''}>
                  <Icon className="h-4 w-4" /><span><b>{label}</b><small>{note}</small></span><strong>{firstJob === id ? '✓' : '→'}</strong>
                </button>
              ))}
            </div>}
            <button
              onClick={() => { setMode('create'); resetError(); }}
              className="w-full flex items-center gap-3 bg-clay-500 text-white rounded-2xl px-5 py-4 text-left hover:opacity-90 transition-opacity"
            >
              <Home size={20} className="shrink-0" />
              <div>
                <div className="font-semibold">{emberMode ? 'Make my first family pulse' : 'Start a new family'}</div>
                <div className="text-sm opacity-80">{emberMode ? 'No giant setup · about three minutes' : "Create your vault — you'll be the admin"}</div>
              </div>
            </button>

            <div className="relative flex items-center">
              <div className="flex-grow border-t border-cream-300" />
              <span className="mx-3 text-ink-400 text-xs uppercase tracking-wider">or</span>
              <div className="flex-grow border-t border-cream-300" />
            </div>

            <button
              onClick={() => { setMode('join'); resetError(); }}
              className="w-full flex items-center gap-3 bg-cream-100 text-ink-800 rounded-2xl px-5 py-4 text-left hover:bg-cream-200 transition-colors border border-cream-300"
            >
              <Key size={20} className="shrink-0 text-sage-500" />
              <div>
                <div className="font-semibold">Join with a code</div>
                <div className="text-sm text-ink-400">Enter the code your family admin shared</div>
              </div>
            </button>

            <button
              onClick={logout}
              className="block w-full text-center text-xs text-ink-400 underline underline-offset-2 hover:text-ink-600 pt-1"
            >
              Sign out
            </button>
          </div>
        )}

        {/* Create family form */}
        {mode === 'create' && (
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="family-name" className="text-sm font-medium text-ink-700">
                Family name
              </label>
              <input
                id="family-name"
                type="text"
                className="field w-full"
                placeholder="e.g. The Clarks"
                value={familyName}
                onChange={(e) => { setFamilyName(e.target.value); resetError(); }}
                autoFocus
                disabled={busy}
              />
            </div>

            {error && (
              <p className="text-sm text-rose-600 bg-rose-50 rounded-xl px-3 py-2">{error}</p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setMode('idle'); resetError(); setFamilyName(''); }}
                className="btn-quiet flex-1"
                disabled={busy}
              >
                Back
              </button>
              <button
                type="submit"
                className="btn-primary flex-1 flex items-center justify-center gap-2"
                disabled={busy}
              >
                {busy && <Loader2 size={16} className="animate-spin" />}
                {busy ? 'Creating…' : 'Create family'}
              </button>
            </div>
          </form>
        )}

        {/* Join family form */}
        {mode === 'join' && (
          <form onSubmit={handleJoin} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="join-code" className="text-sm font-medium text-ink-700">
                Invite code
              </label>
              {/* Placeholder shows the SHAPE of a real invite code (8 chars,
                  A–Z/0–9 — see /api/create-invite). It used to show a UUID
                  pattern, which taught people to paste a family UUID — the one
                  thing that must never work as a join credential, because a
                  family UUID appears inside every document download URL the
                  family shares. */}
              <input
                id="join-code"
                type="text"
                className="field w-full font-mono text-sm tracking-widest uppercase"
                placeholder="e.g. A1B2C3D4"
                maxLength={12}
                value={joinCode}
                onChange={(e) => { setJoinCode(e.target.value); resetError(); }}
                autoFocus
                disabled={busy}
              />
              <p className="text-xs text-ink-400">
                Ask your family admin for an invite code — they create one in Family Settings. Each code works once and expires after 14 days.
              </p>
            </div>

            {error && (
              <p className="text-sm text-rose-600 bg-rose-50 rounded-xl px-3 py-2">{error}</p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setMode('idle'); resetError(); setJoinCode(''); }}
                className="btn-quiet flex-1"
                disabled={busy}
              >
                Back
              </button>
              <button
                type="submit"
                className="btn-primary flex-1 flex items-center justify-center gap-2"
                disabled={busy}
              >
                {busy && <Loader2 size={16} className="animate-spin" />}
                {busy ? 'Joining…' : 'Join family'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
