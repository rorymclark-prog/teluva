import { useEffect, useState } from 'react';
import { Sparkles, X, Check, Globe2, Eye, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import SheetGrabber from './SheetGrabber';

interface Props {
  open: boolean;
  onEnable: () => Promise<void>;  // parent grants consent + closes; while this promise is pending show a loading state on the Enable button
  onClose: () => void;            // "Not now" — dismiss WITHOUT consenting
  onOpenPrivacy?: () => void;     // optional: opens the full privacy policy
}

const CAPABILITIES = [
  'Answer questions about your family’s info',
  'Read photos of documents to file them automatically',
  'Create fun avatar restyles',
];

// One-time, friendly opt-in prompt shown to adults before ANY AI feature runs.
// AI is OFF until they tap Enable. This is a GDPR consent screen: "Not now" is
// just as easy to reach as "Enable" — dismissing it (Escape, backdrop, or the
// button) never grants consent, only onEnable does.
export default function AiConsentModal({ open, onEnable, onClose, onOpenPrivacy }: Props) {
  const [enabling, setEnabling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset transient state each time the prompt is (re)shown.
  useEffect(() => {
    if (open) {
      setEnabling(false);
      setError(null);
    }
  }, [open]);

  // Escape dismisses without consenting, same as "Not now".
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function handleEnable() {
    if (enabling) return; // guard against double-clicks
    setEnabling(true);
    setError(null);
    try {
      await onEnable();
      // On success the parent grants consent and closes this modal itself —
      // nothing further to do here.
    } catch {
      setError('Couldn’t save that — please try again.');
      setEnabling(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
          {/* Backdrop — click dismisses without consenting */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm"
          />

          {/* Modal card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-consent-title"
            className="card relative w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-6 z-10"
          >
            {/* Mobile grabber bar */}
            <SheetGrabber onClose={onClose} className="mb-3" />

            {/* Header */}
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-cream-200">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-2xl bg-clay-50 flex items-center justify-center shrink-0">
                  <Sparkles className="w-5 h-5 text-clay-600" />
                </div>
                <div>
                  <h2 id="ai-consent-title" className="font-display text-xl font-bold text-ink-900 leading-tight">
                    Turn on the AI assistant?
                  </h2>
                  <p className="text-[13px] text-ink-500 mt-0.5">Optional — it stays off until you say so.</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-ink-400 hover:text-ink-700 hover:bg-cream-100 cursor-pointer shrink-0"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="pt-4 space-y-4">
              <div className="space-y-2.5">
                <p className="text-[14px] text-ink-700">Once on, it can:</p>
                <ul className="space-y-2">
                  {CAPABILITIES.map((c) => (
                    <li key={c} className="flex items-start gap-2.5 text-[14px] text-ink-700">
                      <span className="mt-0.5 w-4 h-4 rounded-full bg-sage-100 text-sage-700 flex items-center justify-center shrink-0">
                        <Check className="w-2.5 h-2.5" strokeWidth={3} />
                      </span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Processing transparency */}
              <div className="flex items-start gap-2.5 text-[13px] text-ink-600 bg-cream-100 border border-cream-300 rounded-2xl px-3.5 py-3">
                <Globe2 className="w-4 h-4 text-ink-400 mt-0.5 shrink-0" />
                <p>
                  When you use it, the text and images you send are processed by Google&rsquo;s Vertex AI in the EU
                  (Belgium) to do this. Your content is not used to train Google&rsquo;s models.
                </p>
              </div>

              {/* Caution */}
              <div className="flex items-start gap-2.5 text-[13px] text-ink-500">
                <Eye className="w-4 h-4 mt-0.5 shrink-0" />
                <p>Only send things you&rsquo;re comfortable processing this way.</p>
              </div>

              <p className="text-[13px] text-ink-500">
                The rest of Teluva works fully without AI. You can turn this off again anytime in Settings.
              </p>

              {onOpenPrivacy && (
                <button
                  type="button"
                  onClick={onOpenPrivacy}
                  className="text-[13px] font-semibold text-dusk-700 hover:text-dusk-500 underline underline-offset-2 cursor-pointer"
                >
                  Read our privacy policy
                </button>
              )}

              {error && (
                <div className="text-[13px] text-rosa-700 bg-rosa-50 border border-rosa-100 rounded-xl px-3 py-2">
                  {error}
                </div>
              )}
            </div>

            {/* Footer actions — "Not now" is just as easy to tap as "Enable" */}
            <div className="flex flex-col sm:flex-row-reverse gap-2.5 pt-5 mt-1">
              <button
                type="button"
                onClick={handleEnable}
                disabled={enabling}
                className="btn-primary flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {enabling ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Enabling…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Enable AI assistant
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="btn-quiet flex-1"
              >
                Not now
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
