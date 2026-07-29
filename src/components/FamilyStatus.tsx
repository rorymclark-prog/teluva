import { useEffect, useRef, useState } from 'react';
import { MessageSquareText, Check, X, Pencil } from 'lucide-react';
import type { HubSettings } from '../types';

/**
 * The family's status line — the fridge whiteboard.
 *
 * "Everyone's at Oma's until Sunday." "Mia has chickenpox, don't visit."
 * "Back from Cape Town!" One line, replaced rather than appended, so it stays
 * something you read at a glance instead of turning into a feed with unread
 * counts that nobody keeps up with. That restraint is the whole design: a
 * household of eight will not maintain a timeline, but it will keep one line
 * current.
 *
 * Attributed and dated, because "Shyam is at his gran's this week" only helps
 * if you know who wrote it and whether it was written this week.
 */
const MAX = 140;

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function FamilyStatus({ status, canWrite, authorName, onSave, isBusinessSpace }: {
  status?: HubSettings['status'];
  canWrite: boolean;
  /** Display name recorded against the update. */
  authorName: string;
  onSave: (next: HubSettings['status']) => void;
  isBusinessSpace?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(status?.text ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  // Business spaces get the same feature, worded for an office rather than a
  // family word pasted into one.
  const prompt = isBusinessSpace ? "What's on this week?" : "What's happening this week?";
  const emptyPrompt = isBusinessSpace ? 'Post an update for the team' : "What's happening this week?";

  useEffect(() => { setDraft(status?.text ?? ''); }, [status?.text]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  // Nothing to show and no permission to add one — render nothing rather than
  // an empty card telling a child they can't use it.
  if (!status?.text && !canWrite) return null;

  const commit = () => {
    const text = draft.trim().slice(0, MAX);
    setEditing(false);
    if (text === (status?.text ?? '')) return;          // no-op edits don't restamp the author
    onSave(text ? { text, by: authorName, at: new Date().toISOString() } : undefined);
  };

  const cancel = () => { setDraft(status?.text ?? ''); setEditing(false); };

  if (editing) {
    return (
      <div className="card flex items-center gap-2 p-3">
        <MessageSquareText className="w-4 h-4 shrink-0 text-clay-500" />
        <input
          ref={inputRef}
          value={draft}
          maxLength={MAX}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') cancel();
          }}
          placeholder={prompt}
          aria-label={isBusinessSpace ? "Team status" : "Family status"}
          className="field flex-1"
        />
        <button
          type="button"
          onClick={commit}
          aria-label="Save status"
          className="flex min-w-[44px] min-h-[44px] items-center justify-center rounded-full text-sage-600 hover:bg-sage-50 cursor-pointer"
        >
          <Check className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={cancel}
          aria-label="Cancel"
          className="flex min-w-[44px] min-h-[44px] items-center justify-center rounded-full text-ink-400 hover:bg-cream-100 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    );
  }

  if (!status?.text) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="card flex w-full items-center gap-2.5 p-3 text-left text-ink-400 transition-colors hover:bg-cream-50 cursor-pointer"
      >
        <MessageSquareText className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-[13px]">{emptyPrompt}</span>
      </button>
    );
  }

  return (
    <div className="card flex items-start gap-2.5 p-3">
      <MessageSquareText className="w-4 h-4 shrink-0 text-clay-500 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] text-ink-800 leading-snug">{status.text}</p>
        <p className="mt-0.5 text-[11.5px] text-ink-400">
          {status.by} &middot; {timeAgo(status.at)}
        </p>
      </div>
      {canWrite && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Change the status"
          title="Change the status"
          className="flex min-w-[44px] min-h-[44px] shrink-0 items-center justify-center rounded-full text-ink-400 hover:bg-cream-100 hover:text-ink-700 cursor-pointer"
        >
          <Pencil className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
