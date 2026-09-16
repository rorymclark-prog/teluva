import { useEffect, useState } from 'react';
import { MessageSquare, X, Check, Send, Loader2, Eye } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import SheetGrabber from './SheetGrabber';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { sendFeedback } from '../utils/feedback';

interface Props {
  open: boolean;
  onClose: () => void;
  screen: string;        // the ViewId, stored verbatim — what the report is ABOUT
  screenLabel: string;   // the same screen in the words the person just read on it
}

// Mirrors MAX_FEEDBACK_CHARS in server/feedback.mjs, which is the authority —
// this only drives the counter, so drifting slightly costs nothing worse than
// an unhelpful count.
const MAX_CHARS = 4000;

/**
 * The feedback box.
 *
 * TWO THINGS IT MUST BE HONEST ABOUT, because they are not what the rest of
 * this app does:
 *
 *  1. This message LEAVES the family's space. Every other word typed into
 *     Teluva is visible only to that family. This one goes to the person who
 *     built it. Somebody about to describe a problem involving their family's
 *     documents deserves to know that before they type, not after.
 *  2. The screen name goes with it. Stated plainly rather than collected
 *     quietly — it's the useful part, and there is no version of "we also
 *     send some diagnostic information" that reads better than naming it.
 */
export default function FeedbackModal({ open, onClose, screen, screenLabel }: Props) {
  useBodyScrollLock(open);

  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh box each time it opens — including after a successful send, so the
  // next report doesn't start inside the last one's thank-you.
  useEffect(() => {
    if (open) {
      setMessage('');
      setSending(false);
      setSent(false);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function handleSend() {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendFeedback(text, screen);
      setSent(true);
    } catch (e) {
      setError((e as Error)?.message || 'Couldn’t send that — please try again.');
      setSending(false);
    }
  }

  const over = message.length > MAX_CHARS;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-title"
            className="card relative w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-6 z-10"
          >
            <SheetGrabber onClose={onClose} className="mb-3" />

            <div className="flex items-start justify-between gap-3 pb-4 border-b border-cream-200">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-2xl bg-clay-50 flex items-center justify-center shrink-0">
                  <MessageSquare className="w-5 h-5 text-clay-600" />
                </div>
                <div>
                  <h2 id="feedback-title" className="font-display text-xl font-bold text-ink-900 leading-tight">
                    {sent ? 'Thank you' : 'Tell us what’s not working'}
                  </h2>
                  <p className="text-[13px] text-ink-500 mt-0.5">
                    {sent ? 'That’s been sent.' : 'Anything confusing, missing or broken.'}
                  </p>
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

            {sent ? (
              <div className="pt-5 space-y-4">
                <div className="flex items-start gap-3 text-[14px] text-ink-700">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-sage-100 text-sage-700 flex items-center justify-center shrink-0">
                    <Check className="w-3 h-3" strokeWidth={3} />
                  </span>
                  <p>Genuinely useful — the awkward bits are hard to find from the inside.</p>
                </div>
                <button type="button" onClick={onClose} className="btn-primary w-full">Close</button>
              </div>
            ) : (
              <div className="pt-4 space-y-4">
                <label htmlFor="feedback-text" className="sr-only">Your feedback</label>
                <textarea
                  id="feedback-text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  autoFocus
                  placeholder="I couldn’t work out how to…"
                  className="field w-full resize-y min-h-[120px]"
                />

                <div className="flex items-center justify-between gap-3 -mt-2">
                  <p className="text-[12px] text-ink-500">
                    Sent from <span className="font-semibold text-ink-700">{screenLabel}</span>
                  </p>
                  {message.length > MAX_CHARS - 500 && (
                    <p className={`text-[12px] tabular-nums ${over ? 'text-rosa-600 font-semibold' : 'text-ink-400'}`}>
                      {message.length} / {MAX_CHARS}
                    </p>
                  )}
                </div>

                {/* Said before they type, not after. This is the one message in
                    Teluva that leaves the family's own space. */}
                <div className="flex items-start gap-2.5 text-[13px] text-ink-600 bg-cream-100 border border-cream-300 rounded-2xl px-3.5 py-3">
                  <Eye className="w-4 h-4 text-ink-400 mt-0.5 shrink-0" />
                  <p>
                    This goes to the person who builds Teluva, along with your name and which
                    screen you were on. Nothing else from your family is attached — so if it’s
                    about a particular document, describe it rather than pasting it.
                  </p>
                </div>

                {error && <p className="text-[13px] text-rosa-600">{error}</p>}

                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!message.trim() || over || sending}
                  className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
