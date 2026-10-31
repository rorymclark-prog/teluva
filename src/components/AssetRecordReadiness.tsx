import React from 'react';
import { CheckCircle2, Circle, CalendarClock } from 'lucide-react';
import type { AssetItem } from '../types';
import { assetRecordChecklist, assetReminders, replacementReviewDue } from '../utils/assetRegister';

export default function AssetRecordReadiness({ item }: { item: AssetItem }) {
  const checklist = assetRecordChecklist(item);
  const reminders = assetReminders([item]);
  return (
    <details className="rounded-xl border border-cream-200 bg-cream-50/50 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-ink-700">Record checklist · {checklist.filter(c => c.recorded).length}/{checklist.length} recorded</summary>
      <p className="mt-2 text-xs text-ink-400">A guide to useful evidence. Missing information can be added later; links are checked when preparing a claim pack.</p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {checklist.map(c => <li key={c.label} className={`flex items-center gap-2 text-xs ${c.recorded ? 'text-sage-700' : 'text-ink-500'}`}>
          {c.recorded ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <Circle className="w-3.5 h-3.5 shrink-0" />} {c.label}
        </li>)}
      </ul>
      {replacementReviewDue(item) && <p className="mt-3 text-xs text-ink-500">Review the replacement value and record when you checked it.</p>}
      {reminders.map(r => <p key={r.id} className="flex items-center gap-2 mt-2 text-xs text-clay-700"><CalendarClock className="w-3.5 h-3.5 shrink-0" />{r.label} {r.days === 0 ? 'today' : `in ${r.days} days`} ({r.date}).</p>)}
    </details>
  );
}
