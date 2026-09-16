import { useEffect } from 'react';
import { Printer, X, Phone, AlertTriangle } from 'lucide-react';
import type { FirstHoursPack as Pack } from '../utils/firstHours';
import { CLAIM_DOCUMENTS } from '../utils/firstHours';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

/* The first day or two, on one page.
 *
 * Built to be PRINTED and kept with the signed will. That is not a nice extra
 * — it is the whole design. The person who needs this most is usually the one
 * without an account, and no login screen helps them at 3am. Everything here
 * is deliberately the harmless half: a funeral policy number is useless to a
 * thief, while its absence can cost a family the payout entirely.
 *
 * Layout follows AssetClaimExport.tsx — same modal shell, same print: variants,
 * same window.print(). It is already the pattern in this app for "a page you
 * hand to somebody official", and this is one.
 */
export default function FirstHoursPack({
  pack, hubName, onClose,
}: { pack: Pack; hubName: string; onClose: () => void }) {
  useBodyScrollLock(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const generatedOn = new Date().toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[120] overflow-y-auto bg-ink-900/60 backdrop-blur-sm flex justify-center px-3 py-6 sm:p-8 print:static print:bg-white print:backdrop-blur-none print:p-0 print:overflow-visible"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="The first hours"
        className="w-full max-w-3xl h-fit my-auto bg-white rounded-[28px] border border-cream-300/60 shadow-2xl overflow-hidden anim-pop print:my-0 print:shadow-none print:border-0 print:rounded-none print:max-w-full print:w-full"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-5 sm:p-7 border-b border-cream-200 print:border-b print:border-ink-900">
          <div className="min-w-0">
            <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-ink-900 leading-tight tracking-tight">
              The first hours
            </h2>
            <p className="text-[13px] sm:text-sm font-bold text-rosa-700 mt-1 leading-snug">
              What to do and who to phone in the first day or two — {hubName}.
            </p>
            <p className="text-[12px] text-ink-400 font-medium mt-1 tabular-nums">
              Printed {generatedOn}. Keep this with the signed will.
            </p>
          </div>
          <div className="flex items-center gap-2 print:hidden shrink-0">
            <button onClick={() => window.print()} className="btn-primary" title="Print or save as PDF">
              <Printer className="w-4 h-4" /> <span className="hidden sm:inline">Print / Save as PDF</span>
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

        <div className="p-5 sm:p-7 space-y-7">
          {/* 1. WHO TO PHONE. First, because it is the only thing that is
              genuinely urgent — funeral cover pays out in 24-48 hours once the
              documents are in, and cannot start until somebody rings. */}
          <section>
            <h3 className="section-label mb-3">Phone these first</h3>
            {pack.policies.length === 0 ? (
              <p className="text-[13.5px] text-ink-500">No funeral cover or burial society is recorded.</p>
            ) : (
              <ul className="space-y-3">
                {pack.policies.map((p) => (
                  <li key={p.id} className="rounded-2xl border border-cream-300 p-3.5 print:border-ink-300">
                    <p className="font-bold text-ink-900 text-[15px]">{p.provider}</p>
                    <dl className="mt-1.5 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-[13.5px]">
                      {p.claimsPhone && (
                        <div className="flex items-center gap-1.5 sm:col-span-2">
                          <Phone className="w-3.5 h-3.5 text-rosa-700 shrink-0 print:hidden" />
                          <dt className="text-ink-500">Claims line</dt>
                          <dd className="font-bold text-ink-900 tabular-nums">{p.claimsPhone}</dd>
                        </div>
                      )}
                      {p.burialSocietyContact && (
                        <div className="flex items-center gap-1.5 sm:col-span-2">
                          <Phone className="w-3.5 h-3.5 text-rosa-700 shrink-0 print:hidden" />
                          <dt className="text-ink-500">Contact</dt>
                          <dd className="font-bold text-ink-900">{p.burialSocietyContact}</dd>
                        </div>
                      )}
                      {p.policyNumber && (
                        <div className="flex gap-1.5">
                          <dt className="text-ink-500">Policy no.</dt>
                          <dd className="font-semibold text-ink-900 tabular-nums">{p.policyNumber}</dd>
                        </div>
                      )}
                      {p.beneficiary && (
                        <div className="flex gap-1.5">
                          <dt className="text-ink-500">Pays out to</dt>
                          <dd className="font-semibold text-ink-900">{p.beneficiary}</dd>
                        </div>
                      )}
                      {p.repatriationDestination && (
                        <div className="flex gap-1.5 sm:col-span-2">
                          <dt className="text-ink-500">Repatriation</dt>
                          <dd className="font-semibold text-ink-900">{p.repatriationDestination}</dd>
                        </div>
                      )}
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 2. What the claim needs. Static, and a checklist because it is
              read under pressure. */}
          <section>
            <h3 className="section-label mb-3">What the claim needs</h3>
            <ul className="space-y-1.5">
              {CLAIM_DOCUMENTS.map((d) => (
                <li key={d} className="flex items-start gap-2.5 text-[13.5px] text-ink-700">
                  <span className="mt-[3px] w-3.5 h-3.5 rounded border border-ink-300 shrink-0" aria-hidden />
                  {d}
                </li>
              ))}
            </ul>
          </section>

          {/* 3. Wishes and the whereabouts of the signed original. */}
          {(pack.wishes.length > 0 || pack.wills.length > 0) && (
            <section>
              <h3 className="section-label mb-3">Wishes, and where the papers are</h3>
              <ul className="space-y-2.5 text-[13.5px]">
                {pack.wishes.map((w) => (
                  <li key={w.id}>
                    <span className="font-bold text-ink-900">Funeral wishes. </span>
                    <span className="text-ink-700">{w.notes || w.originalLocation || 'Recorded — see Wills & Estate.'}</span>
                  </li>
                ))}
                {pack.wills.map((w) => (
                  <li key={w.id}>
                    <span className="font-bold text-ink-900">The signed will. </span>
                    <span className="text-ink-700">
                      {[w.originalLocation, w.heldBy && `held by ${w.heldBy}`, w.executor && `executor ${w.executor}`,
                        w.notaryPhone && `notary ${w.notaryPhone}`]
                        .filter(Boolean).join(' · ') || 'Recorded — see Wills & Estate.'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 4. Who must be told. */}
          {pack.notify.length > 0 && (
            <section>
              <h3 className="section-label mb-3">Who must be told</h3>
              <ul className="grid sm:grid-cols-2 gap-2 text-[13.5px]">
                {pack.notify.map((c) => (
                  <li key={c.id} className="rounded-xl border border-cream-300 px-3 py-2 print:border-ink-300">
                    <span className="font-bold text-ink-900">{c.name}</span>
                    {c.relation && <span className="text-ink-500"> · {c.relation}</span>}
                    {c.phone && <span className="block text-ink-700 tabular-nums">{c.phone}</span>}
                    {c.email && <span className="block text-ink-700 break-all">{c.email}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 5. Keys and safes. */}
          {pack.keysAndSafes && (
            <section>
              <h3 className="section-label mb-3">Keys and safes</h3>
              <p className="text-[13.5px] text-ink-700 whitespace-pre-wrap">{pack.keysAndSafes}</p>
            </section>
          )}

          {/* 6. THE GAPS. Printed, not hidden — a short page that looks
              finished is the failure this whole screen exists to prevent. */}
          {pack.gaps.length > 0 && (
            <section className="rounded-2xl bg-amber-50 border border-amber-200 p-4 print:bg-white print:border-ink-300">
              <h3 className="flex items-center gap-2 text-[13px] font-extrabold uppercase tracking-wide text-amber-900 mb-2">
                <AlertTriangle className="w-4 h-4 shrink-0" /> Still missing
              </h3>
              <ul className="space-y-1 text-[13px] text-amber-900">
                {pack.gaps.map((g) => <li key={g}>· {g}</li>)}
              </ul>
            </section>
          )}

          {/* The boundary, stated on the page itself so nobody assumes this
              sheet is the whole vault. */}
          <p className="text-[12px] text-ink-400 leading-relaxed border-t border-cream-200 pt-4">
            This page deliberately carries none of the sensitive half — no account numbers, ID or passport
            numbers, medical records or stored documents. Those stay in Teluva, behind sign-in.
          </p>
        </div>
      </div>
    </div>
  );
}
