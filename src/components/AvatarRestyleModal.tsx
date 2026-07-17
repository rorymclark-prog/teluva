import { useState } from 'react';
import { X, Sparkles, RefreshCw, Check, Undo2 } from 'lucide-react';
import type { FamilyMember } from '../types';
import { auth } from '../lib/firebase';

// Keys MUST match AVATAR_STYLES in server.js.
const STYLES: { key: string; label: string; emoji: string }[] = [
  { key: 'pixar', label: 'Pixar', emoji: '🧸' },
  { key: 'watercolor', label: 'Watercolour', emoji: '🎨' },
  { key: 'renaissance', label: 'Renaissance', emoji: '🖼️' },
  { key: 'superhero', label: 'Superhero', emoji: '🦸' },
  { key: 'lego', label: 'LEGO', emoji: '🧱' },
  { key: 'clay', label: 'Claymation', emoji: '🗿' },
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

const styleLabel = (key: string | null) => STYLES.find((s) => s.key === key)?.label ?? '';

export default function AvatarRestyleModal({ member, onClose, onApply, onReset }: Props) {
  // Always restyle from the REAL photo if one was stashed, so styles never stack.
  const sourceUrl = member.avatarOriginalUrl || member.avatarUrl || '';
  const [phase, setPhase] = useState<'pick' | 'busy' | 'preview'>('pick');
  const [result, setResult] = useState<string | null>(null);
  const [activeStyle, setActiveStyle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function generate(style: string) {
    const parsed = parseDataUrl(sourceUrl);
    if (!parsed) {
      setError('This photo can’t be restyled — try re-uploading it.');
      return;
    }
    setActiveStyle(style);
    setPhase('busy');
    setError(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Please sign in again.');
      const token = await user.getIdToken();
      const res = await fetch('/api/restyle-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image: parsed, style }),
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
        className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-lift max-h-[90vh] overflow-y-auto"
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
                  <p className="text-[11px] text-clay-600 mt-1.5 font-semibold">{styleLabel(activeStyle)}</p>
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
              <p className="text-sm font-semibold text-ink-800">Creating your {styleLabel(activeStyle)} avatar…</p>
              <p className="text-[12px] text-ink-400">This takes about 10 seconds.</p>
            </div>
          ) : (
            <>
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
                    onClick={() => generate(s.key)}
                    className="flex flex-col items-center gap-1 p-3 rounded-2xl border border-cream-300 hover:border-clay-400 hover:bg-clay-50 transition-colors cursor-pointer"
                  >
                    <span className="text-2xl leading-none">{s.emoji}</span>
                    <span className="text-[12px] font-semibold text-ink-700">{s.label}</span>
                  </button>
                ))}
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
