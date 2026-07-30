import { useState } from 'react';
import { X, Sparkles, RefreshCw, Check, Undo2 } from 'lucide-react';
import type { FamilyMember } from '../types';
import { auth } from '../lib/firebase';
import { FUN_PRESETS, startFunPhotoJob, useFunPhotoJob, clearFunPhotoJob } from '../utils/funPhotoLab';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

// Keys MUST match AVATAR_STYLES in server.js.
const STYLES: { key: string; label: string; emoji: string }[] = [
  { key: 'pixar', label: 'Pixar', emoji: '🧸' },
  { key: 'watercolor', label: 'Watercolour', emoji: '🎨' },
  { key: 'renaissance', label: 'Renaissance', emoji: '🖼️' },
  { key: 'superhero', label: 'Superhero', emoji: '🦸' },
  { key: 'lego', label: 'LEGO', emoji: '🧱' },
  { key: 'clay', label: 'Claymation', emoji: '🗿' },
];

// Quick-fill ideas for the "describe your own" box — deliberately different
// from the preset grid above so switching to free text still feels fresh.
const PROMPT_IDEAS: { label: string; prompt: string }[] = [
  { label: '🧙 Fantasy wizard', prompt: 'a fantasy wizard, flowing robes and a staff' },
  { label: '🚀 Retro astronaut', prompt: 'a retro 1960s sci-fi astronaut in a space helmet' },
  { label: '🌊 Studio Ghibli', prompt: 'a warm hand-painted Studio Ghibli-style anime character' },
  { label: '🏴‍☠️ Pirate captain', prompt: 'a swashbuckling pirate captain, tricorn hat' },
  { label: '📼 90s yearbook', prompt: 'a cheesy 1990s school yearbook photo, laser background' },
  { label: '🎮 Video game hero', prompt: 'a stylised video game character portrait, fantasy RPG art style' },
  { label: '🎄 Christmas card', prompt: 'a cosy, festive Christmas-card portrait with warm fairy lights' },
  { label: '🌸 Anime chibi', prompt: 'a cute chibi anime-style character, big eyes, simple shading' },
];

interface Props {
  member: FamilyMember;
  onClose: () => void;
  onApply: (memberId: string, dataUrl: string, style: string) => Promise<void>;
  onReset: (memberId: string) => Promise<void>;
}

function parseDataUrl(src: string): { mimeType: string; data: string } | null {
  const m = src.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  return m ? { mimeType: m[1], data: m[2] } : null;
}

const styleLabel = (key: string | null) => STYLES.find((s) => s.key === key)?.label ?? (key === 'custom' ? 'Custom' : '');

export default function AvatarRestyleModal({ member, onClose, onApply, onReset }: Props) {
  // Parent only mounts this component while the modal should be visible
  // ({restyleMemberId && <AvatarRestyleModal .../>} in Dashboard.tsx), so
  // the modal is "always open" for as long as it's mounted.
  useBodyScrollLock(true);

  // Always restyle from the REAL photo if one was stashed, so styles never stack.
  const sourceUrl = member.avatarOriginalUrl || member.avatarUrl || '';
  const [phase, setPhase] = useState<'pick' | 'busy' | 'preview'>('pick');
  const [result, setResult] = useState<string | null>(null);
  const [activeStyle, setActiveStyle] = useState<string | null>(null);
  const [activeLabel, setActiveLabel] = useState<string>('');
  const [customText, setCustomText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Fun photo lab — background job for THIS member, if any. Lives outside
  // this component (see funPhotoLab.ts) so it survives the sheet closing.
  const funJob = useFunPhotoJob(member.id);
  const [funSaving, setFunSaving] = useState(false);

  async function generate(style: string, label: string, customPrompt?: string) {
    const parsed = parseDataUrl(sourceUrl);
    if (!parsed) {
      setError('This photo can’t be restyled — try re-uploading it.');
      return;
    }
    setActiveStyle(style);
    setActiveLabel(label);
    setPhase('busy');
    setError(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Please sign in again.');
      const token = await user.getIdToken();
      const body: Record<string, unknown> = { image: parsed, style };
      if (customPrompt) body.customPrompt = customPrompt;
      const res = await fetch('/api/restyle-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.image) throw new Error(data.error || 'Could not create the avatar.');
      setResult(data.image);
      setPhase('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setPhase('pick');
    }
  }

  const generatePreset = (key: string) => generate(key, styleLabel(key));
  const generateCustom = () => {
    const text = customText.trim();
    if (!text) return;
    generate('custom', 'Custom', text);
  };

  async function useIt() {
    if (!result || !activeStyle) return;
    setSaving(true);
    try {
      await onApply(member.id, result, activeStyle);
      onClose();
    } catch {
      setError('Could not save the new avatar.');
      setSaving(false);
    }
  }

  const isStyled = !!member.avatarStyle && !!member.avatarOriginalUrl;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-ink-900/40 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-lift max-h-[90dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-cream-200 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-clay-500" />
            <h3 className="font-display text-lg font-bold text-ink-900">Fun avatar</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink-400 hover:text-ink-700 hover:bg-cream-100 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {error && (
            <div className="text-[13px] text-rosa-700 bg-rosa-50 border border-rosa-100 rounded-xl px-3 py-2">{error}</div>
          )}

          {phase === 'preview' && result ? (
            <div className="space-y-5">
              <div className="flex items-center justify-center gap-5">
                <div className="text-center">
                  <div className="avatar-ring">
                    <img src={sourceUrl} className="w-24 h-24 rounded-full object-cover" alt="original" />
                  </div>
                  <p className="text-[11px] text-ink-400 mt-1.5 font-semibold">Original</p>
                </div>
                <div className="text-center">
                  <div className="avatar-ring">
                    <img src={result} className="w-24 h-24 rounded-full object-cover" alt="restyled" />
                  </div>
                  <p className="text-[11px] text-clay-600 mt-1.5 font-semibold">{activeLabel}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={useIt} disabled={saving} className="btn-primary flex-1 disabled:opacity-50">
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Use it
                </button>
                <button
                  onClick={() => { setPhase('pick'); setResult(null); }}
                  disabled={saving}
                  className="btn-quiet flex-1"
                >
                  Try another
                </button>
              </div>
            </div>
          ) : phase === 'busy' ? (
            <div className="py-10 text-center space-y-3">
              <div className="w-14 h-14 rounded-full bg-clay-50 flex items-center justify-center mx-auto">
                <RefreshCw className="w-6 h-6 text-clay-500 animate-spin" />
              </div>
              <p className="text-sm font-semibold text-ink-800">Creating your {activeLabel} avatar…</p>
              <p className="text-[12px] text-ink-400">This takes about 10 seconds.</p>
            </div>
          ) : (
            <>
              {funJob?.status === 'done' && funJob.resultDataUrl && (
                <div className="rounded-2xl border border-clay-300 bg-clay-50 p-3 space-y-3">
                  <div className="flex items-center gap-3">
                    <img src={funJob.resultDataUrl} className="w-14 h-14 rounded-full object-cover border border-cream-300 shrink-0" alt={funJob.presetLabel} />
                    <p className="text-[13px] font-semibold text-ink-800">🎉 {funJob.presetLabel} is ready!</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        setFunSaving(true);
                        try {
                          await onApply(member.id, funJob.resultDataUrl!, funJob.presetKey);
                          clearFunPhotoJob(member.id);
                          onClose();
                        } catch {
                          setError('Could not save the new photo.');
                          setFunSaving(false);
                        }
                      }}
                      disabled={funSaving}
                      className="btn-primary flex-1 disabled:opacity-50"
                    >
                      {funSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Use it
                    </button>
                    <button
                      type="button"
                      onClick={() => clearFunPhotoJob(member.id)}
                      disabled={funSaving}
                      className="btn-quiet flex-1"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <img src={sourceUrl} className="w-14 h-14 rounded-full object-cover border border-cream-300 shrink-0" alt={member.name} />
                <p className="text-[13px] text-ink-500">
                  Pick a style — the AI reimagines {member.name}’s photo. Nothing changes until you tap <b>Use it</b>.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {STYLES.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => generatePreset(s.key)}
                    className="flex flex-col items-center gap-1 p-3 rounded-2xl border border-cream-300 hover:border-clay-400 hover:bg-clay-50 transition-colors cursor-pointer"
                  >
                    <span className="text-2xl leading-none">{s.emoji}</span>
                    <span className="text-[12px] font-semibold text-ink-700">{s.label}</span>
                  </button>
                ))}
              </div>

              {/* Or describe your own */}
              <div className="pt-1 space-y-2.5">
                <p className="text-[12px] font-semibold text-ink-500">Or describe your own style</p>
                <div className="flex flex-wrap gap-1.5">
                  {PROMPT_IDEAS.map((idea) => (
                    <button
                      key={idea.label}
                      type="button"
                      onClick={() => setCustomText(idea.prompt)}
                      className="chip bg-cream-100 text-ink-600 border border-cream-300 hover:bg-cream-200 transition-colors text-[12px]"
                    >
                      {idea.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); generateCustom(); } }}
                    placeholder="e.g. a viking with a big beard"
                    maxLength={200}
                    className="field flex-1"
                  />
                  <button
                    type="button"
                    onClick={generateCustom}
                    disabled={!customText.trim()}
                    className="btn-primary shrink-0 disabled:opacity-40"
                  >
                    <Sparkles className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Fun photo lab — ready-made group/scene presets that generate in
                  the background. Separate from the style grid above: this is
                  preset-only (no free text ever reaches the AI, see
                  funPhotoLab.ts) and does not block the sheet while it runs. */}
              <div className="pt-2 space-y-2.5 border-t border-cream-200">
                <p className="text-[12px] font-semibold text-ink-500 pt-3">
                  Fun photo lab <span className="text-ink-400 font-normal">— runs in the background, close whenever</span>
                </p>
                {funJob?.status === 'running' ? (
                  <div className="flex items-center gap-2.5 rounded-2xl border border-clay-200 bg-clay-50 px-3 py-2.5">
                    <RefreshCw className="w-4 h-4 text-clay-500 animate-spin shrink-0" />
                    <p className="text-[12px] text-ink-600">
                      Cooking up <b>{funJob.presetLabel}</b>… you can close this now, we’ll let you know.
                    </p>
                  </div>
                ) : funJob?.status === 'error' ? (
                  <div className="flex items-center justify-between gap-2.5 rounded-2xl border border-rosa-100 bg-rosa-50 px-3 py-2.5">
                    <p className="text-[12px] text-rosa-700">{funJob.error || `Couldn’t create ${funJob.presetLabel}.`}</p>
                    <button
                      type="button"
                      onClick={() => clearFunPhotoJob(member.id)}
                      className="text-[12px] font-semibold text-rosa-700 underline shrink-0 cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {FUN_PRESETS.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => startFunPhotoJob(member, sourceUrl, p.key)}
                        disabled={!parseDataUrl(sourceUrl)}
                        className="flex flex-col items-center gap-1 p-3 rounded-2xl border border-cream-300 hover:border-clay-400 hover:bg-clay-50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <span className="text-2xl leading-none">{p.emoji}</span>
                        <span className="text-[12px] font-semibold text-ink-700">{p.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {isStyled && (
                <button
                  onClick={async () => { await onReset(member.id); onClose(); }}
                  className="w-full flex items-center justify-center gap-1.5 text-[13px] font-semibold text-ink-500 hover:text-ink-800 py-2 cursor-pointer"
                >
                  <Undo2 className="w-4 h-4" /> Reset to real photo
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
