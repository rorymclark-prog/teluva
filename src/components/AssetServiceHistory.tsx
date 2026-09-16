/* ---------------------------------------------------------------------------
 * An item's own service history — the dishwasher's repairs, on the dishwasher.
 *
 * Rory, 2026-09-12: "imagine i had a dishwasher service where do we keep it?
 * the document". The job is logged once, in the house's work log, with
 * `assetId` naming the item. This block is READ-ONLY and DERIVED from that
 * log (serviceHistoryForAsset): the item stores nothing, so there is no second
 * copy to drift. Receipts open from here exactly as they do in the log.
 *
 * Shown in AssetDetailModal (a member's Belongings) and in Assets.tsx's edit
 * form — the latter matters because a dishwasher belongs to nobody, so it
 * never appears on a member's Belongings card at all.
 * ------------------------------------------------------------------------- */

import { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';
import type { AssetItem, HouseholdInfo } from '../types';
import { loadHousehold } from '../utils/db';
import { useSharedDoc } from '../hooks/useSharedDoc';
import { isDemoMode } from '../utils/demoData';
import { serviceHistoryForAsset } from '../utils/serviceDocs';
import { ServiceDocChips, useVaultDocs } from './ServiceDocs';

export default function AssetServiceHistory({ assetId, category }: {
  assetId?: string;
  category?: AssetItem['category'];
}) {
  const demo = isDemoMode();
  const [household, setHousehold] = useState<HouseholdInfo | null>(null);
  useEffect(() => {
    if (!assetId) return;
    let active = true;
    loadHousehold()
      .then((h) => { if (active) setHousehold(h || {}); })
      .catch(() => { if (active) setHousehold({}); });
    return () => { active = false; };
  }, [assetId]);
  useSharedDoc<HouseholdInfo>('household', (h) => setHousehold(h || {}), { disabled: demo || !assetId });
  const vault = useVaultDocs(demo || !assetId);

  if (!assetId || !household) return null;
  const entries = serviceHistoryForAsset(household, assetId);
  if (entries.length === 0) {
    // Only an appliance gets the "how to fill this" hint — on a necklace
    // an empty service history is noise, not an invitation.
    if (category !== 'Appliance') return null;
    return (
      <div>
        <p className="text-[11.5px] font-semibold text-ink-400 uppercase tracking-wider mb-1 flex items-center gap-1"><Wrench className="w-3 h-3" /> Service history</p>
        <p className="text-[12px] text-ink-400">Nothing logged yet. When it is serviced or repaired, log it under Household → “Work done”, choose this item, and attach the invoice.</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[11.5px] font-semibold text-ink-400 uppercase tracking-wider mb-1.5 flex items-center gap-1"><Wrench className="w-3 h-3" /> Service history</p>
      <div className="space-y-2">
        {entries.map((r) => (
          <div key={r.id} className="rounded-xl border border-cream-200 bg-white p-2.5">
            <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-ink-400">
              {r.date && <span className="tabular-nums">{r.date}</span>}
              {r.trade && <span className="text-clay-700">{r.trade}</span>}
            </div>
            <p className="text-[13px] font-medium text-ink-800">{r.work}</p>
            <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink-500">
              {r.by && <span>{r.by}</span>}
              {r.cost && <span className="font-semibold text-ink-700 tabular-nums">{r.cost}</span>}
              {r.warrantyUntil && <span className="tabular-nums">Guaranteed to {r.warrantyUntil}</span>}
            </div>
            <ServiceDocChips ids={r.docIds} docs={vault.docs} className="mt-1.5" />
          </div>
        ))}
      </div>
    </div>
  );
}
