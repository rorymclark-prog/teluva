import { useMemo, useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { IdCard, X, Copy, Check, Globe, ShieldCheck, Plane, KeyRound, FileText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FamilyMember, FamilyDocument } from '../types';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { useT } from '../i18n/LangContext';
import { buildIdOverview, countIdOverviewItems, type IdOverviewKind } from '../utils/idOverview';
import { resolveIdOverviewScans, idOverviewEmptiness } from '../utils/idOverviewDocs';
import { formatRevealsForCopy } from '../utils/aiReveal';
import { expiryChip } from './MemberIDs';
import { categoryChipClass } from './MemberDocuments';
import DocThumb from './DocThumb';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import SheetGrabber from './SheetGrabber';
import EmptyState from './EmptyState';

interface Props {
  member: FamilyMember;
  open: boolean;
  onClose: () => void;
  /** Opens the SAME document viewer every other screen uses — see MemberIDsProps's own doc comment. */
  onViewDocument: (doc: FamilyDocument, memberName: string) => void;
}

const GROUP_ICON: Record<IdOverviewKind, LucideIcon> = {
  identity: ShieldCheck,
  passport: Globe,
  visa: Plane,
  other: KeyRound,
};

/**
 * "Mia has many id numbers and document numbers, passport number, but
 * there is no easy way to see them all" — and then, once this screen existed
 * to answer that: "it's got passports but then goes straight into an
 * editable section — I think all documents should be listed with
 * thumbnails." One member, every identity number/passport/visa/permit (and,
 * for an admin, every national identifier) AND every filed document, all
 * read-only, all with a visual thumbnail where one exists — reached from the
 * ID & Passports tab rather than a new top-level nav item.
 *
 * Two data sources, kept deliberately separate:
 *
 *  - Section A (the numbers) reads nothing itself: buildIdOverview()
 *    (utils/idOverview.ts) is a thin wrapper around aiReveal.ts's
 *    buildRevealIndex(), the same enumeration + admin gate the AI chat's
 *    "from your records" card uses, so this screen and that card can never
 *    show a different set of numbers for the same member. See idOverview.ts's
 *    header for why that matters.
 *
 *  - Section B (the documents) is simply member.documents — everything filed
 *    for this person, not just the ones that happen to back an ID number.
 *
 *  resolveIdOverviewScans (utils/idOverviewDocs.ts) links the two: it finds
 *  each Section-A row's scan with the SAME finder the ID & Passports tab
 *  itself uses (findIdentityScan/findPassportScan/findVisaScan), so a
 *  passport that autopulls its photo there autopulls the identical photo
 *  here, and it marks any Section-B document that is already "spoken for" by
 *  a Section-A row instead of that document appearing twice with no
 *  relationship shown.
 *
 * Every thumbnail — a Section-A scan or a Section-B document — goes through
 * DocThumb, never a bare <img>. A passport scanned through the app's own
 * scanner is a PDF (the two-sided ID flow compiles both sides with
 * compileImagesToPdf); an <img> pointed at that renders the browser's
 * broken-image glyph. See DocThumb.tsx's header for the incident this exists
 * to stop from happening a second time.
 */
export default function MemberIdOverview({ member, open, onClose, onViewDocument }: Props) {
  useBodyScrollLock(open);
  const { isAdmin } = useFamilyCtx();
  const { t } = useT();

  const groups = useMemo(() => buildIdOverview(member, isAdmin), [member, isAdmin]);
  const total = countIdOverviewItems(groups);
  const documents = useMemo(() => member.documents || [], [member.documents]);

  const { scanByItemId, itemLabelsByDocId } = useMemo(
    () => resolveIdOverviewScans(member, groups),
    [member, groups],
  );
  const emptiness = idOverviewEmptiness(total, documents.length);

  // A tick only ever follows a RESOLVED navigator.clipboard.writeText — never
  // shown optimistically, so a blocked/denied clipboard permission stays
  // silent rather than claiming a copy that did not happen. Keyed by row id
  // (or 'all' for the whole-screen copy) so exactly one button acknowledges.
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);
  const copyValue = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedKey(key);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopiedKey(null), 1600);
    }).catch(() => { /* clipboard unavailable/denied — stay silent, no false tick */ });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // formatRevealsForCopy groups by NAME and expects RevealedValue-shaped
  // objects (memberName/field/value) — reused as-is rather than a second,
  // possibly-differently-worded "copy everything" formatter, since this is
  // exactly the block AIChatbot's own "Copy all" already produces.
  const copyAllText = () => formatRevealsForCopy(
    groups.flatMap(g => g.items.map(it => ({
      id: it.id, label: it.label, field: it.label, memberName: member.name, value: it.value,
    }))),
  );

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            role="dialog" aria-modal="true" aria-labelledby="id-overview-title"
            className="card relative w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-6 z-10"
          >
            <SheetGrabber onClose={onClose} className="mb-3" />

            <div className="flex items-start justify-between gap-3 pb-4 border-b border-cream-200">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-11 h-11 rounded-2xl bg-honey-100 flex items-center justify-center shrink-0">
                  <IdCard className="w-5 h-5 text-honey-700" />
                </div>
                <div className="min-w-0">
                  <h2 id="id-overview-title" className="font-display text-xl font-bold text-ink-900 leading-tight truncate">
                    {t.id_overview_title}
                  </h2>
                  <p className="text-[13px] text-ink-500 mt-0.5 truncate">{member.name}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-ink-400 hover:text-ink-700 hover:bg-cream-100 cursor-pointer shrink-0"
                aria-label={t.btn_close}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="pt-4">
              {emptiness === 'all' ? (
                <EmptyState
                  icon={IdCard}
                  tone="honey"
                  title={t.id_overview_empty_title}
                  description={t.id_overview_empty_desc}
                />
              ) : (
                <div className="space-y-5">
                  {/* ── Section A: ID numbers ──────────────────────────── */}
                  {emptiness !== 'numbers' ? (
                    <div className="rounded-2xl border border-honey-300 bg-honey-50 overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-honey-200 text-[11.5px] font-semibold uppercase tracking-wide text-honey-900">
                        <IdCard className="w-3.5 h-3.5 shrink-0" />
                        <span className="flex-1 min-w-0 truncate">{t.id_overview_title}</span>
                        {/* Second control, not a replacement for the per-row copy —
                          * the row gives the bare value (right for a form field),
                          * this gives names and labels together (right for a
                          * message to a travel agent or a school). */}
                        <button
                          type="button"
                          onClick={() => copyValue('all', copyAllText())}
                          className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-honey-300 bg-white/70 text-honey-900 text-[11px] font-semibold normal-case tracking-normal cursor-pointer hover:bg-honey-100"
                        >
                          {copiedKey === 'all'
                            ? <><Check className="w-3 h-3" /> {t.ai_reveal_copied}</>
                            : <><Copy className="w-3 h-3" /> {total > 1 ? t.ai_reveal_copy_all : t.ai_reveal_copy_named}</>}
                        </button>
                      </div>

                      <div className="divide-y divide-honey-200">
                        {groups.map((g) => {
                          const GroupIcon = GROUP_ICON[g.kind];
                          const groupLabel = g.kind === 'identity' ? t.id_overview_group_identity
                            : g.kind === 'passport' ? t.id_overview_group_passport
                            : g.kind === 'visa' ? t.id_overview_group_visa
                            : t.id_overview_group_other;
                          return (
                            <div key={g.kind} className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-honey-900 mb-1.5">
                                <GroupIcon className="w-3.5 h-3.5 shrink-0" />
                                {groupLabel}
                              </div>
                              <div className="space-y-1.5">
                                {g.items.map((it) => {
                                  const scan = scanByItemId.get(it.id);
                                  return (
                                    <div key={it.id} className="flex items-center gap-2">
                                      {scan && (
                                        <button
                                          type="button"
                                          onClick={() => onViewDocument(scan, member.name)}
                                          className="shrink-0"
                                          aria-label={`${t.id_overview_view_document}: ${it.label}`}
                                        >
                                          <DocThumb src={scan.fileData} fileType={scan.fileType} size="w-10 h-10" alt="" />
                                        </button>
                                      )}
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="text-[11.5px] text-ink-500">{it.label}</span>
                                          {it.expiry && expiryChip(it.expiry)}
                                        </div>
                                        <div className="text-[14px] font-semibold text-ink-800 tabular-nums break-all">
                                          {it.value}
                                        </div>
                                      </div>
                                      <button
                                        type="button"
                                        aria-label={`${t.ai_reveal_copy}: ${it.label}`}
                                        onClick={() => copyValue(it.id, it.value)}
                                        className="shrink-0 p-2 rounded-xl border border-honey-300 bg-white/70 text-honey-900 cursor-pointer hover:bg-honey-100"
                                      >
                                        {copiedKey === it.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[12.5px] text-ink-400 italic px-1">{t.id_overview_empty_title}</p>
                  )}

                  {/* ── Section B: documents ───────────────────────────── */}
                  <div>
                    <div className="flex items-center gap-1.5 px-1 mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-500">
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span>{t.nav_documents}</span>
                      {documents.length > 0 && (
                        <span className="font-normal normal-case tracking-normal text-ink-400 tabular-nums">
                          ({documents.length})
                        </span>
                      )}
                    </div>
                    {emptiness !== 'documents' ? (
                      <div className="rounded-2xl border border-honey-300 bg-honey-50 p-2 space-y-1.5">
                        {documents.map((doc) => {
                          const attachedTo = itemLabelsByDocId.get(doc.id);
                          return (
                            <button
                              key={doc.id}
                              type="button"
                              onClick={() => onViewDocument(doc, member.name)}
                              className="w-full flex items-center gap-3 p-2 rounded-xl border border-honey-200 bg-white/70 hover:bg-honey-100 text-left cursor-pointer"
                              aria-label={`${t.id_overview_view_document}: ${doc.name}`}
                            >
                              <DocThumb src={doc.fileData} fileType={doc.fileType} size="w-12 h-12" alt={doc.name} />
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-semibold text-ink-800 truncate">{doc.name}</p>
                                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                  <span className={categoryChipClass(doc.category)}>{doc.category}</span>
                                  {doc.uploadedAt && (
                                    <span className="text-[11px] text-ink-400 tabular-nums">{doc.uploadedAt}</span>
                                  )}
                                </div>
                                {attachedTo && attachedTo.length > 0 && (
                                  <p className="text-[11px] text-honey-700 mt-1 truncate">
                                    {t.id_overview_attached_to}: {attachedTo.join(', ')}
                                  </p>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[12.5px] text-ink-400 italic px-1">{t.id_overview_documents_empty}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
