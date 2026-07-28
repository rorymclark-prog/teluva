import { RefreshCw } from 'lucide-react';

// Shown inside an open editor when another family member changed the same
// shared list while it has been open. The change is NOT applied yet — see
// hooks/useSharedDoc.ts: incoming updates are held while an editor is open and
// land automatically the moment it closes. This is just the courtesy notice, so
// nobody is surprised when the list looks different after they hit Save.
//
// Deliberately not a button and not dismissible: there is nothing for the user
// to do, and the resolution is automatic. Finishing what you were typing is
// always safe — the write is merged item-by-item, never as a whole-list
// overwrite (see utils/mergeShared.ts).
export default function RemoteChangeHint({ show, className = '' }: { show: boolean; className?: string }) {
  if (!show) return null;
  return (
    <div className={`flex items-start gap-2 rounded-xl bg-dusk-50 text-dusk-700 px-3 py-2 text-[12px] font-medium ${className}`}>
      <RefreshCw className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span>Someone else just changed this list. Your changes are safe — the update appears once you're done here.</span>
    </div>
  );
}
