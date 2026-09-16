import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, CalendarHeart, GraduationCap, HeartPulse, MapPin, Maximize2, Minimize2, Pencil, Plane, TrendingUp, SlidersHorizontal } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { FamilyMember, TimelineEntry } from '../types';
import type { FamilyTimelineItem } from '../utils/familyTimeline';
import { preferredTimelineYear, timelineChapters, timelineRange, timelineYears, type TimelineScale } from '../utils/visualTimeline';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import './VisualTimeline.css';

const ICONS = { memories: CalendarHeart, medical: HeartPulse, education: GraduationCap, addresses: MapPin, growth: TrendingUp, travel: Plane, calendar: CalendarDays };
const dateLabel = (item: FamilyTimelineItem) => item.dateLabel || (!item.date ? 'Date not recorded' : item.date.length === 4 ? `${item.date} · exact date not recorded` : new Date(`${item.date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }));
const monthName = (month: number) => new Date(2024, month, 1).toLocaleDateString(undefined, { month: 'long' });

export default function VisualTimeline({ items, members, onOpenRecord, onEdit, onDelete, busy, filters }: {
  items: FamilyTimelineItem[]; members: FamilyMember[];
  onOpenRecord?: (target: NonNullable<FamilyTimelineItem['target']>) => void;
  onEdit?: (entry: TimelineEntry) => void; onDelete?: (entry: TimelineEntry) => void; busy?: boolean; filters?: React.ReactNode;
}) {
  const [year, setYear] = useState(() => preferredTimelineYear(items));
  const [month, setMonth] = useState(new Date().getMonth());
  const [scale, setScale] = useState<TimelineScale>('year');
  const [selectedId, setSelectedId] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const lastWindow = useRef('');
  const years = useMemo(() => timelineYears(items), [items]);
  const chapters = useMemo(() => timelineChapters(items, year, month, scale), [items, year, month, scale]);
  const undated = items.filter(item => !item.date);
  const yearOnly = items.filter(item => item.date === String(year));
  const ranges = items.map(item => ({ item, range: timelineRange(item, year, month, scale) })).filter(entry => entry.range);
  const periodItems = chapters.flatMap(chapter => chapter.items);
  const selectable = [...periodItems, ...yearOnly, ...undated, ...ranges.map(r => r.item)];
  const thisMonth = periodItems.filter(item => item.date.slice(0, 7) === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`);
  const suggested = thisMonth.find(item => item.imageUrl || ['education', 'memories'].includes(item.category)) || thisMonth[0] || periodItems.filter(item => item.date <= new Date().toLocaleDateString('en-CA')).at(-1);
  const selected = selectable.find(item => item.id === selectedId) || suggested || periodItems.at(-1) || yearOnly[0] || ranges[0]?.item || undated[0];
  const selectedChapter = chapters.find(chapter => chapter.items.some(item => item.id === selected?.id));
  const group = selectedChapter?.items || (selected?.date.length === 4 ? yearOnly : selected?.date ? [selected] : undated);
  const selectedIndex = group.findIndex(item => item.id === selected?.id);
  const slots = scale === 'year' ? 12 : new Date(year, month + 1, 0).getDate();
  const slotWidth = scale === 'year' ? 190 : 150;
  const width = slots * slotWidth + 120;
  const firstYear = years[0] ?? year, lastYear = years.at(-1) ?? year;
  const personNames = (item: FamilyTimelineItem) => item.memberIds.length ? item.memberIds.map(id => members.find(member => member.id === id)?.name || 'Family member').join(' · ') : 'Family';
  const jumpToYear = (next: number) => { setYear(next); setSelectedId(''); };
  useEffect(() => {
    if (years.length && (year < years[0] || year > years.at(-1)!)) jumpToYear(preferredTimelineYear(items));
  }, [years.join(',')]);
  useEffect(() => {
    const key = `${year}:${month}:${scale}:${expanded}`;
    if (!scroller.current || lastWindow.current === key) return;
    lastWindow.current = key;
    const active = selectedChapter || chapters.at(-1);
    scroller.current.scrollLeft = Math.max(0, 60 + ((active?.index ?? 0) + 0.5) * slotWidth - scroller.current.clientWidth / 2);
  }, [year, month, scale, expanded, chapters]);
  const activeChapterIndex = useRef(0); activeChapterIndex.current = selectedChapter?.index ?? chapters.at(-1)?.index ?? 0;
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let previousWidth = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === previousWidth) return;
      previousWidth = element.clientWidth;
      element.scrollLeft = Math.max(0, 60 + (activeChapterIndex.current + 0.5) * slotWidth - element.clientWidth / 2);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, slotWidth]);
  useEffect(() => {
    if (!expanded) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const background = [...document.body.children].filter(element => element !== panel.current && element instanceof HTMLElement).map(element => ({ element: element as HTMLElement, inert: (element as HTMLElement).inert }));
    background.forEach(({ element }) => { element.inert = true; });
    panel.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setExpanded(false); }
      if (event.key === 'Tab' && panel.current) {
        const controls = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), select, input, [tabindex="0"]')].filter(el => el.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => { background.forEach(({ element, inert }) => { element.inert = inert; }); document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', handleKey); (previousFocus?.isConnected ? previousFocus : expandButton.current)?.focus(); };
  }, [expanded]);
  const open = (item: FamilyTimelineItem) => { setExpanded(false); if (item.target) onOpenRecord?.(item.target); };
  const select = (item: FamilyTimelineItem) => setSelectedId(item.id);
  const scroll = (direction: number) => scroller.current?.scrollBy({ left: direction * scroller.current.clientWidth * 0.72, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  const content = <section ref={panel} className={`story-timeline ${expanded ? 'story-timeline--expanded' : ''}`} role={expanded ? 'dialog' : 'region'} aria-modal={expanded || undefined} aria-label="Visual family timeline" tabIndex={expanded ? -1 : undefined}>
    <div className="story-toolbar">
      <div className="story-period"><span className="story-eyebrow">A life in chapters</span><div className="story-period-controls">
        <button type="button" className="story-icon-button" aria-label="Previous year" disabled={year <= firstYear} onClick={() => jumpToYear(year - 1)}><ArrowLeft size={18} /></button>
        <label><span className="sr-only">Timeline year</span><select value={year} onChange={event => jumpToYear(Number(event.target.value))}>{[...new Set([...years, year])].sort((a,b) => a-b).map(value => <option key={value}>{value}</option>)}</select></label>
        <button type="button" className="story-icon-button" aria-label="Next year" disabled={year >= lastYear} onClick={() => jumpToYear(year + 1)}><ArrowRight size={18} /></button>
      </div></div>
      <div className="story-tools"><div className="story-scale" role="group" aria-label="Timeline detail"><button type="button" aria-pressed={scale === 'year'} onClick={() => setScale('year')}>Year</button><button type="button" aria-pressed={scale === 'month'} onClick={() => { if (selectedChapter && scale === 'year') setMonth(selectedChapter.index); setScale('month'); }}>Month</button></div>
        {scale === 'month' && <label><span className="sr-only">Timeline month</span><select className="story-month" value={month} onChange={event => { setMonth(Number(event.target.value)); setSelectedId(''); }}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{monthName(i)}</option>)}</select></label>}
        {expanded && filters && <button type="button" className="story-icon-button" aria-label="Timeline filters" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal size={18} /></button>}
        <button ref={expandButton} type="button" className="story-icon-button" aria-label={expanded ? 'Close expanded timeline' : 'Expand timeline'} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 size={20} /> : <Maximize2 size={20} />}</button>
      </div>
    </div>
    {expanded && showFilters && <div className="story-expanded-filters">{filters}</div>}
    <div className="story-hint"><span>{periodItems.length} dated {periodItems.length === 1 ? 'moment' : 'moments'} · {scale === 'year' ? 'One chapter per month' : `${monthName(month)} · One chapter per day`}</span><span>Swipe or scroll along the line <ArrowRight size={14} /></span></div>
    {yearOnly.length > 0 && <div className="story-loose"><span>During {year}</span>{yearOnly.map(item => <button type="button" key={item.id} className={`story-tag story-${item.category}`} aria-pressed={selected?.id === item.id} onClick={() => select(item)}><GraduationCap size={14} />{item.title} · {item.dateLabel}</button>)}<small>Exact dates not recorded</small></div>}
    <div className="story-scroll" ref={scroller} tabIndex={0} aria-label="Scrollable timeline. Use left and right arrow keys to move." onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); scroll(event.key === 'ArrowRight' ? 1 : -1); } }}>
      <div className="story-canvas" style={{ width }}>
        <div className="story-spine" style={{ left: 60, right: 60 }} />
        {Array.from({ length: slots }, (_, index) => <div key={index} className="story-tick" style={{ left: 60 + (index + 0.5) * slotWidth }}><span>{scale === 'year' ? monthName(index).slice(0, 3) : index + 1}</span></div>)}
        {chapters.map((chapter, index) => {
          const active = chapter.items.find(item => item.id === selected?.id);
          const lead = active || chapter.items.find(item => item.imageUrl) || chapter.items.find(item => ['memories', 'education', 'addresses', 'travel'].includes(item.category)) || chapter.items[0];
          const Icon = ICONS[lead.category];
          return <div key={chapter.key} className={`story-chapter ${index % 2 ? 'story-below' : 'story-above'} story-${lead.category} ${active ? 'story-selected' : ''}`} style={{ left: 60 + (chapter.index + 0.5) * slotWidth }}>
            <div className="story-stem" /><div className="story-node"><Icon size={16} /></div>
            <button type="button" className="story-card" aria-pressed={!!active} aria-label={`${chapter.label}: ${lead.title}${chapter.items.length > 1 ? ` and ${chapter.items.length - 1} more` : ''}`} onClick={() => select(lead)}>
              {lead.imageUrl ? <img src={lead.imageUrl} alt="" loading="lazy" className="story-card-photo" /> : <div className="story-card-art"><Icon size={32} strokeWidth={1.3} /><span>{lead.sourceLabel}</span></div>}
              <div className="story-card-copy"><span className="story-card-date">{chapter.label}{chapter.items.length > 1 && <b>+{chapter.items.length - 1}</b>}</span><strong>{lead.title}</strong><small>{personNames(lead)}</small></div>
            </button>
          </div>;
        })}
        {!chapters.length && <p className="story-empty" style={{ left: (scroller.current?.scrollLeft || 0) + 40 }}>No dated moments in this {scale}. Choose another {scale} or add a moment.</p>}
      </div>
      {ranges.length > 0 && <div className="story-residences" style={{ width }}>{ranges.map(({ item, range }) => <div className="story-range-row" key={item.id}><button type="button" className="story-residence" style={{ left: 60 + range!.start * (width - 120), width: Math.max(10, (range!.end - range!.start) * (width - 120)) }} onClick={() => select(item)} aria-label={`${item.rangeLabel}, ${item.date} to ${item.endDate}`}><MapPin size={13} /><span>{item.rangeLabel}</span></button></div>)}</div>}
    </div>
    <div className="story-under-line"><span>Earlier <span aria-hidden="true">⟶</span> Later · {ranges.length ? 'Home bands show recorded residence dates' : 'Select a chapter to explore its moments'}</span><div><button type="button" className="story-icon-button" aria-label="Scroll timeline earlier" onClick={() => scroll(-1)}><ArrowLeft size={17} /></button><button type="button" className="story-icon-button" aria-label="Scroll timeline later" onClick={() => scroll(1)}><ArrowRight size={17} /></button></div></div>
    {selected && <div className={`story-detail story-${selected.category}`} aria-live="polite">
      <div className="story-detail-top"><span className="story-eyebrow">{selectedChapter ? `${selectedChapter.label} · ${selectedIndex + 1} of ${group.length}` : selected.date ? 'Chapter details' : 'Still part of your story'}</span><div className="story-detail-navigation"><button type="button" className="story-icon-button" aria-label="Previous moment in chapter" disabled={selectedIndex <= 0} onClick={() => select(group[selectedIndex - 1])}><ArrowLeft size={16} /></button><button type="button" className="story-icon-button" aria-label="Next moment in chapter" disabled={selectedIndex < 0 || selectedIndex >= group.length - 1} onClick={() => select(group[selectedIndex + 1])}><ArrowRight size={16} /></button></div></div>
      <div className="story-detail-body">{selected.imageUrl && <img src={selected.imageUrl} alt={selected.title} className="story-detail-photo" loading="lazy" />}<div className="story-detail-copy"><p className="story-detail-date">{dateLabel(selected)} · {selected.sourceLabel}</p><h3>{selected.title}</h3><p className="story-detail-person">{personNames(selected)}</p>{selected.note && <p className="story-detail-note">{selected.note}</p>}<div className="story-detail-actions">{selected.target && onOpenRecord && <button type="button" className="btn-quiet text-xs" onClick={() => open(selected)}>Open {selected.sourceLabel.toLowerCase()}<ArrowUpRight size={14} /></button>}{selected.manual && onEdit && <button type="button" className="btn-quiet text-xs" onClick={() => { setExpanded(false); onEdit(selected.manual!); }}><Pencil size={14} />Edit moment</button>}{selected.manual && onDelete && <ConfirmDeleteButton disabled={busy} ariaLabel={`Delete ${selected.title}`} onConfirm={() => onDelete(selected.manual!)} />}</div></div></div>
      {group.length > 1 && <div className="story-siblings" aria-label="Moments in this chapter">{group.map(item => { const Icon = ICONS[item.category]; return <button key={item.id} type="button" className={`story-tag story-${item.category}`} aria-pressed={selected.id === item.id} onClick={() => select(item)}><Icon size={14} />{item.title}</button>; })}</div>}
    </div>}
    {years.length > 0 && <div className="story-overview"><div className="story-overview-label"><span className="story-eyebrow">Your whole story</span><span>{firstYear === lastYear ? firstYear : `${firstYear} — ${lastYear}`} · drag to travel through years</span></div><div className="story-overview-track">{years.map(value => <span key={value} className={value === year ? 'is-current' : ''} style={{ left: `${lastYear === firstYear ? 50 : (value - firstYear) / (lastYear - firstYear) * 100}%`, height: Math.min(28, 5 + items.filter(item => item.date.startsWith(String(value))).length * 2) }} />)}<input type="range" min={firstYear} max={lastYear === firstYear ? lastYear + 1 : lastYear} disabled={firstYear === lastYear} value={year} step={1} aria-label="Travel through years" aria-valuetext={String(year)} onChange={event => jumpToYear(Number(event.target.value))} /></div></div>}
    {undated.length > 0 && <details className="story-undated"><summary>{undated.length} {undated.length === 1 ? 'moment without a date' : 'moments without dates'}</summary><p>Kept here until a date is recorded.</p><div className="story-siblings">{undated.map(item => <button type="button" key={item.id} className={`story-tag story-${item.category}`} aria-pressed={selected?.id === item.id} onClick={() => select(item)}>{item.title}</button>)}</div></details>}
  </section>;
  return expanded ? createPortal(content, document.body) : content;
}
