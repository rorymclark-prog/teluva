import { Fragment, useEffect, useMemo, useState } from 'react';
import { FileDown, Printer, X, ShieldAlert } from 'lucide-react';
import type { AssetItem } from '../types';
import { parseAmount } from '../utils/money';

// The canonical claim list. If the list a family gives the police differs even
// slightly from the one they give their insurer, payouts get cut 20-40% on
// mismatch grounds — so this export is the single source of truth for both.
// Same columns, same order, same values, every time it's generated.

type Scope = 'all' | 'incident';

const CSV_COLUMNS = [
  'Item', 'Make / model', 'Category', 'Identifier type', 'Serial / identifier',
  'Purchase date', 'Purchase price', 'Replacement value', 'Condition',
  'Owner', 'Storage / security', 'Status', 'Date of loss', 'Police reference', 'Incident notes',
] as const;

// The "stolen / lost" scope is exactly what its label says — status-driven, so a
// recovered item (status back to owned) never lingers on the claim list.
function isClaimItem(item: AssetItem): boolean {
  return item.status === 'stolen' || item.status === 'lost';
}

// Replacement value is preferred (what it costs to replace today); purchase
// price is the fallback when no replacement value has been entered.
function itemValue(item: AssetItem): number {
  return item.replacementValue ? parseAmount(item.replacementValue) : parseAmount(item.purchasePrice);
}

function formatEuro(n: number): string {
  return new Intl.NumberFormat('de-AT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(n);
}

// Always-quote CSV cell — simplest safe rule for commas/quotes/newlines in
// free-text fields (names, notes-derived values, etc).
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(',');
}

export default function AssetClaimExport({ items, onClose }: { items: AssetItem[]; onClose: () => void }) {
  const [scope, setScope] = useState<Scope>('all');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const claimCount = useMemo(() => items.filter(isClaimItem).length, [items]);
  const scoped = useMemo(
    () => (scope === 'incident' ? items.filter(isClaimItem) : items),
    [items, scope],
  );
  const totalValue = useMemo(() => scoped.reduce((sum, item) => sum + itemValue(item), 0), [scoped]);
  const generatedOn = useMemo(() => new Date().toLocaleString(), []);

  const handleDownloadCsv = () => {
    const lines = [csvRow([...CSV_COLUMNS])];
    for (const item of scoped) {
      const incidentApplies = isClaimItem(item);
      lines.push(
        csvRow([
          item.name,
          [item.make, item.model].filter(Boolean).join(' '),
          item.category,
          item.identifierType || '',
          item.serialNumber || '',
          item.purchaseDate || '',
          item.purchasePrice || '',
          item.replacementValue || '',
          item.condition || '',
          item.assignedMember || '',
          item.storageSecurity || '',
          item.status || 'owned',
          incidentApplies ? item.incident?.date || '' : '',
          incidentApplies ? item.incident?.policeReference || '' : '',
          incidentApplies ? item.incident?.notes || '' : '',
        ]),
      );
    }
    const csv = lines.join('\r\n');
    // Leading BOM so Excel opens German umlauts/ß as UTF-8, not mojibake.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'family-assets-claim-list.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[120] overflow-y-auto bg-ink-900/60 backdrop-blur-sm flex justify-center px-3 py-6 sm:p-8 print:static print:bg-white print:backdrop-blur-none print:p-0 print:overflow-visible"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Insurance and police claim list"
        className="w-full max-w-5xl h-fit my-auto bg-white rounded-[28px] border border-cream-300/60 shadow-2xl overflow-hidden anim-pop print:my-0 print:shadow-none print:border-0 print:rounded-none print:max-w-full print:w-full"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-5 sm:p-7 border-b border-cream-200 print:border-b print:border-ink-900">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="p-2.5 rounded-2xl bg-rosa-700 text-white shrink-0 print:hidden">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-ink-900 leading-tight tracking-tight">
                Insurance &amp; police claim list
              </h2>
              <p className="text-[13px] sm:text-sm font-bold text-rosa-700 mt-1 leading-snug">
                Give this identical list to the police and your insurer — a mismatch can reduce your payout.
              </p>
              <p className="text-[12px] text-ink-400 font-medium mt-1 tabular-nums">Generated {generatedOn}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 print:hidden shrink-0">
            <button onClick={() => window.print()} className="btn-quiet" title="Print or save as PDF">
              <Printer className="w-4 h-4" /> <span className="hidden sm:inline">Print / Save as PDF</span>
            </button>
            <button onClick={handleDownloadCsv} className="btn-primary" title="Download CSV">
              <FileDown className="w-4 h-4" /> <span className="hidden sm:inline">Download CSV</span>
            </button>
            <button
              onClick={onClose}
              className="p-2.5 rounded-full bg-ink-900/5 text-ink-500 hover:bg-ink-900/10 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scope toggle */}
        <div className="flex items-center gap-2 px-5 sm:px-7 py-3.5 border-b border-cream-200 print:hidden">
          <button
            onClick={() => setScope('all')}
            className={`tab-pill ${scope === 'all' ? 'tab-pill-active' : 'bg-cream-100'}`}
          >
            All items <span className="chip bg-white/20 text-current px-1.5">{items.length}</span>
          </button>
          <button
            onClick={() => setScope('incident')}
            className={`tab-pill ${scope === 'incident' ? 'tab-pill-active' : 'bg-cream-100'}`}
          >
            Stolen / lost only <span className="chip bg-white/20 text-current px-1.5">{claimCount}</span>
          </button>
        </div>

        {/* Body */}
        {scoped.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-semibold text-ink-700">
              {scope === 'incident' ? 'No stolen or lost items on file.' : 'No assets on file yet.'}
            </p>
            <p className="text-[13px] text-ink-400 mt-1">
              {scope === 'incident'
                ? 'Mark an asset as stolen or lost, or add incident details, and it will appear here.'
                : 'Add an asset first, then come back to generate a claim list.'}
            </p>
          </div>
        ) : (
          <div className="p-5 sm:p-7">
            <div className="overflow-x-auto rounded-2xl border border-cream-200">
              <table className="w-full text-left text-[13px] border-collapse">
                <thead>
                  <tr className="bg-cream-100 text-[11px] font-bold uppercase tracking-wide text-ink-500">
                    <th className="px-4 py-2.5 border-b border-cream-300">Item</th>
                    <th className="px-4 py-2.5 border-b border-cream-300">Category</th>
                    <th className="px-4 py-2.5 border-b border-cream-300">Identifier</th>
                    <th className="px-4 py-2.5 border-b border-cream-300">Purchased</th>
                    <th className="px-4 py-2.5 border-b border-cream-300">Replacement value</th>
                    <th className="px-4 py-2.5 border-b border-cream-300">Condition</th>
                    <th className="px-4 py-2.5 border-b border-cream-300">Owner</th>
                    <th className="px-4 py-2.5 border-b border-cream-300">Storage</th>
                  </tr>
                </thead>
                <tbody>
                  {scoped.map((item) => {
                    const incidentApplies = isClaimItem(item);
                    const makeModel = [item.make, item.model].filter(Boolean).join(' ');
                    const purchased = [item.purchaseDate, item.purchasePrice].filter(Boolean).join(' · ');
                    return (
                      <Fragment key={item.id}>
                        <tr className="odd:bg-white even:bg-cream-50/60 align-top">
                          <td className="px-4 py-2.5 border-b border-cream-200">
                            <p className="font-semibold text-ink-900">{item.name}</p>
                            {makeModel && <p className="text-[12px] text-ink-500">{makeModel}</p>}
                          </td>
                          <td className="px-4 py-2.5 border-b border-cream-200 text-ink-700">{item.category}</td>
                          <td className="px-4 py-2.5 border-b border-cream-200">
                            {item.serialNumber ? (
                              <>
                                {item.identifierType && (
                                  <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">
                                    {item.identifierType}
                                  </p>
                                )}
                                <p className="font-mono text-[12px] text-ink-800">{item.serialNumber}</p>
                              </>
                            ) : (
                              <span className="text-ink-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 border-b border-cream-200 text-ink-700">
                            {purchased || <span className="text-ink-400">—</span>}
                          </td>
                          <td className="px-4 py-2.5 border-b border-cream-200 text-ink-700">
                            {item.replacementValue || <span className="text-ink-400">—</span>}
                          </td>
                          <td className="px-4 py-2.5 border-b border-cream-200 text-ink-700">
                            {item.condition || <span className="text-ink-400">—</span>}
                          </td>
                          <td className="px-4 py-2.5 border-b border-cream-200 text-ink-700">
                            {item.assignedMember || <span className="text-ink-400">—</span>}
                          </td>
                          <td className="px-4 py-2.5 border-b border-cream-200 text-ink-700">
                            {item.storageSecurity || <span className="text-ink-400">—</span>}
                          </td>
                        </tr>
                        {incidentApplies && (
                          <tr className="bg-rosa-50">
                            <td colSpan={8} className="px-4 py-2 border-b border-cream-200 text-[12px] text-rosa-700">
                              <span className="inline-flex items-center gap-1.5 font-bold uppercase tracking-wide">
                                <ShieldAlert className="w-3.5 h-3.5" />
                                {item.status === 'lost' ? 'Lost' : item.status === 'stolen' ? 'Stolen' : (item.incident?.type ?? 'Incident')}
                              </span>
                              <span className="ml-3 font-semibold">
                                Date of loss:{' '}
                                <span className="font-mono">{item.incident?.date || 'not recorded'}</span>
                              </span>
                              <span className="ml-3 font-semibold">
                                Police ref:{' '}
                                <span className="font-mono">{item.incident?.policeReference || 'not recorded'}</span>
                              </span>
                              {item.incident?.notes && <span className="ml-3 italic">{item.incident.notes}</span>}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer totals */}
            <div className="flex items-center justify-between gap-3 mt-4 px-1 flex-wrap">
              <p className="text-[13px] font-semibold text-ink-600">
                {scoped.length} {scoped.length === 1 ? 'item' : 'items'}
              </p>
              <p className="text-[13px] font-bold text-ink-900">
                Total value: <span className="tabular-nums">{formatEuro(totalValue)}</span>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
