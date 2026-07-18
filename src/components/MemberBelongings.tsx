import { useState, useEffect } from 'react';
import { Package } from 'lucide-react';
import type { AssetItem } from '../types';
import { loadAssets } from '../utils/db';

// Case-insensitive match, WITHOUT loose substring containment (which would
// cross-attribute e.g. "Ann" → "Joanna"). Matches on: exact full name, OR when
// one side is a bare first name equal to the other's first name (so "Mia"
// matches "Mia Clark", and "Rory Michael Clark" matches "Rory"). Two different
// full names that merely share a first name do NOT match.
function isAssignedTo(assignedMember: string | undefined, memberName: string): boolean {
  if (!assignedMember || !assignedMember.trim()) return false;
  const a = assignedMember.trim().toLowerCase().replace(/\s+/g, ' ');
  const m = memberName.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!m) return false;
  if (a === m) return true;
  const aParts = a.split(' ');
  const mParts = m.split(' ');
  if (aParts.length === 1 && aParts[0] === mParts[0]) return true;  // "Mia" ↔ "Mia Clark"
  if (mParts.length === 1 && mParts[0] === aParts[0]) return true;  // full ↔ bare first name
  return false;
}

export default function MemberBelongings({ memberName, onViewPhoto }: { memberName: string; onViewPhoto?: (src: string) => void }) {
  const [items, setItems] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAssets()
      .then((all) => {
        if (cancelled) return;
        setItems((all || []).filter((item) => isAssignedTo(item.assignedMember, memberName)));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [memberName]);

  if (loading) {
    return (
      <div className="card p-6 flex items-center justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-cream-300 border-t-clay-500 animate-spin" />
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-2.5">
        <div className="p-1.5 rounded-lg bg-sage-100 text-sage-700 shrink-0">
          <Package className="w-3.5 h-3.5" />
        </div>
        <h3 className="text-[13px] font-bold text-ink-800">Belongings</h3>
        <span className="text-[11px] text-ink-400">{items.length}</span>
      </div>

      <div className="divide-y divide-cream-200">
        {items.map((item) => {
          const value = item.replacementValue || item.purchasePrice;
          const statusChip = item.status === 'stolen' ? 'Stolen' : item.status === 'lost' ? 'Lost' : null;
          const hasPhoto = !!item.photoDataUrl;
          const canView = hasPhoto && !!onViewPhoto;

          return (
            <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
              {canView ? (
                <button
                  type="button"
                  onClick={() => onViewPhoto?.(item.photoDataUrl!)}
                  className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-cream-100 flex items-center justify-center ring-1 ring-cream-200 hover:ring-clay-300 transition-all cursor-zoom-in"
                  title="View photo"
                >
                  <img src={item.photoDataUrl} alt={item.name} className="w-full h-full object-cover" />
                </button>
              ) : (
                <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-cream-100 flex items-center justify-center">
                  <Package className="w-4 h-4 text-ink-300" />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink-800 truncate">{item.name}</p>
                {(item.make || item.model) && (
                  <p className="text-[11px] text-ink-400 truncate">
                    {[item.make, item.model].filter(Boolean).join(' ')}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {statusChip && (
                  <span className="chip bg-rosa-100 text-rosa-700">{statusChip}</span>
                )}
                {value && (
                  <span className="chip bg-cream-100 text-ink-600 tabular-nums">{value}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
