import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, CalendarHeart, GraduationCap, HeartPulse, MapPin, Maximize2, Minimize2, Pencil, Plane, TrendingUp, SlidersHorizontal } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { FamilyDocument, FamilyMember, TimelineEntry } from '../types';
import type { FamilyTimelineItem } from '../utils/familyTimeline';
import { lifeTimelineTicks, fitTimelineChapters, lifeTimelineChapters, preferredTimelineYear, timelineChapters, timelineRange, timelineYears, type TimelineScale } from '../utils/visualTimeline';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import './VisualTimeline.css';

const ICONS = { memories: CalendarHeart, medical: HeartPulse, education: GraduationCap, addresses: MapPin, growth: TrendingUp, travel: Plane, calendar: CalendarDays };
const dateLabel = (item: FamilyTimelineItem) => item.dateLabel || (!item.date ? 'Date not recorded' : item.date.length === 4 ? `${item.date} · exact date not recorded` : new Date(`${item.date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }));
const monthName = (month: number) => new Date(2024, month, 1).toLocaleDateString(undefined, { month: 'long' });

export default function VisualTimeline({ items, domainItems = items, members, isBusinessSpace = false, onOpenRecord, onEdit, onDelete, busy, filters, renderDetails, onOpenDocument }: {
  items: FamilyTimelineItem[]; members: FamilyMember[];
  /** Person-scoped records before category/search filters: filters never shorten a life. */
  domainItems?: FamilyTimelineItem[];
  isBusinessSpace?: boolean;
  onOpenDocument?: (document: FamilyDocument) => void;
  onOpenRecord?: (target: NonNullable<FamilyTimelineItem['target']>) => void;
  onEdit?: (entry: TimelineEntry) => void; onDelete?: (entry: TimelineEntry) => void; busy?: boolean; filters?: React.ReactNode; renderDetails?: (item: FamilyTimelineItem, openDocument: (document: FamilyDocument) => void) => React.ReactNode;
}) {
  const [year, setYear] = useState(() => preferredTimelineYear(items));
  const [month, setMonth] = useState(new Date().getMonth());
  const [scale, setScale] = useState<TimelineScale>('life');
  const [layout, setLayout] = useState<'fit' | 'scroll' | null>(null);
  const fitted = layout === 'fit' || (layout === null && scale === 'life');
  const [viewportWidth, setViewportWidth] = useState(900);
  const [selectedId, setSelectedId] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const lastWindow = useRef('');
  const years = useMemo(() => timelineYears(domainItems), [domainItems]);
  const firstYear = years[0] ?? year, lastYear = Math.max(years.at(-1) ?? year, new Date().getFullYear());
  const periodSlots = scale === 'life' ? lastYear - firstYear + 1 : scale === 'year' ? 12 : new Date(year, month + 1, 0).getDate();
  const slots = fitted ? Math.min(periodSlots, Math.max(2, Math.floor((viewportWidth - 100) / 85))) : periodSlots;
  const chapters = useMemo(() => scale === 'life'
    ? lifeTimelineChapters(items, slots, lastYear, firstYear)
    : fitTimelineChapters(timelineChapters(items, year, month, scale), periodSlots, slots),
  [items, year, month, scale, slots, periodSlots, firstYear, lastYear]);
  const undated = items.filter(item => !item.date);
  const yearOnly = scale === 'life' ? [] : items.filter(item => item.date === String(year) || (scale === 'month' && item.date === `${year}-${String(month + 1).padStart(2, '0')}`));
  const ranges = items.map(item => ({ item, range: timelineRange(item, year, month, scale, [firstYear, lastYear]) })).filter(entry => entry.range);
  const periodItems = chapters.flatMap(chapter => chapter.items);
  const selectable = [...periodItems, ...yearOnly, ...undated, ...ranges.map(r => r.item)];
  const thisMonth = periodItems.filter(item => item.date.slice(0, 7) === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`);
  const suggested = thisMonth.find(item => item.imageUrl || ['education', 'memories'].includes(item.category)) || thisMonth[0] || periodItems.filter(item => item.date <= new Date().toLocaleDateString('en-CA')).at(-1);
  const selected = selectable.find(item => item.id === selectedId) || suggested || periodItems.at(-1) || yearOnly[0] || ranges[0]?.item || undated[0];
  const selectedChapter = chapters.find(chapter => chapter.items.some(item => item.id === selected?.id));
  const group = selectedChapter?.items || (selected?.date.length === 4 ? yearOnly : selected?.date ? [selected] : undated);
  const selectedIndex = group.findIndex(item => item.id === selected?.id);
  const padding = scale === 'life' ? 50 : 60;
  const slotWidth = fitted ? Math.max(1, viewportWidth - padding * 2) / slots : scale === 'year' ? 190 : 150;
  const width = slots * slotWidth + padding * 2;
  const cardWidth = fitted ? Math.min(160, Math.max(64, slotWidth * 1.65)) : 180;
  const personNames = (item: FamilyTimelineItem) => item.memberIds.length ? item.memberIds.map(id => members.find(member => member.id === id)?.name || 'Family member').join(' · ') : isBusinessSpace ? 'Business' : 'Family';
  const jumpToYear = (next: number) => { setYear(next); setSelectedId(''); if (scale === 'life') setScale('year'); };
  const changeScale = (next: TimelineScale) => {
    if (next !== 'life' && selected?.date) {
      setYear(Number(selected.date.slice(0, 4)));
      if (selected.date.length === 10) setMonth(Number(selected.date.slice(5, 7)) - 1);
    }
    setScale(next);
  };
  useEffect(() => {
    if (years.length && (year < firstYear || year > lastYear)) { setYear(preferredTimelineYear(domainItems)); setSelectedId(''); }
  }, [years.join(',')]);
  useEffect(() => {
    const key = `${year}:${month}:${scale}:${expanded}:${fitted ? viewportWidth : ''}:${fitted}`;
    if (!scroller.current || lastWindow.current === key) return;
    lastWindow.current = key;
    const active = selectedChapter || chapters.at(-1);
    scroller.current.scrollLeft = fitted ? 0 : Math.max(0, 60 + ((active?.index ?? 0) + 0.5) * slotWidth - scroller.current.clientWidth / 2);
  }, [year, month, scale, expanded, chapters, viewportWidth, fitted]);
  const activeChapterIndex = useRef(0); activeChapterIndex.current = selectedChapter?.index ?? chapters.at(-1)?.index ?? 0;
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let previousWidth = element.clientWidth;
    setViewportWidth(element.clientWidth);
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === previousWidth) return;
      previousWidth = element.clientWidth;
      setViewportWidth(element.clientWidth);
      element.scrollLeft = fitted ? 0 : Math.max(0, 60 + (activeChapterIndex.current + 0.5) * slotWidth - element.clientWidth / 2);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, slotWidth, scale, fitted]);
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
  const activate = (item: FamilyTimelineItem, grouped = false) => {
    select(item);
    if (!grouped && item.documents?.length === 1 && onOpenDocument) {
      setExpanded(false);
      onOpenDocument(item.documents[0]);
    } else requestAnimationFrame(() => detail.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };
  const scroll = (direction: number) => scroller.current?.scrollBy({ left: direction * scroller.current.clientWidth * 0.72, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  const content = <section ref={panel} className={`story-timeline ${scale === 'life' ? 'story-timeline--life' : ''} ${expanded ? 'story-timeline--expanded' : ''} ${cardWidth < 125 ? 'story-timeline--compact' : ''}`} style={{ '--story-card-width': `${cardWidth}px` } as React.CSSProperties} role={expanded ? 'dialog' : 'region'} aria-modal={expanded || undefined} aria-label={isBusinessSpace ? 'Visual business timeline' : 'Visual family timeline'} tabIndex={expanded ? -1 : undefined}>
    <div className="story-toolbar">
      <div className="story-period"><span className="story-eyebrow">{isBusinessSpace ? 'Business history' : 'A life in chapters'}</span><div className="story-period-controls">{scale === 'life' ? <span className="story-life-span">{years.length ? `${firstYear} — ${lastYear}` : isBusinessSpace ? 'Your business history' : 'Your whole life'}</span> : <>
        <button type="button" className="story-icon-button" aria-label="Previous year" disabled={year <= firstYear} onClick={() => jumpToYear(year - 1)}><ArrowLeft size={18} /></button>
        <label><span className="sr-only">Timeline year</span><select value={year} onChange={event => jumpToYear(Number(event.target.value))}>{Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i).map(value => <option key={value}>{value}</option>)}</select></label>
        <button type="button" className="story-icon-button" aria-label="Next year" disabled={year >= lastYear} onClick={() => jumpToYear(year + 1)}><ArrowRight size={18} /></button>
      </>}</div></div>
      <div className="story-tools"><div className="story-scale" role="group" aria-label="Timeline detail">{(['life', 'year', 'month'] as TimelineScale[]).map(value => <button key={value} type="button" aria-pressed={scale === value} onClick={() => changeScale(value)}>{value === 'life' && isBusinessSpace ? 'All time' : value[0].toUpperCase() + value.slice(1)}</button>)}</div>
        {scale === 'month' && <label><span className="sr-only">Timeline month</span><select className="story-month" value={month} onChange={event => { setMonth(Number(event.target.value)); setSelectedId(''); }}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{monthName(i)}</option>)}</select></label>}
        {expanded && filters && <button type="button" className="story-icon-button" aria-label="Timeline filters" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal size={18} /></button>}
        <button ref={expandButton} type="button" className="story-icon-button" aria-label={expanded ? 'Close expanded timeline' : 'Expand timeline'} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 size={20} /> : <Maximize2 size={20} />}</button>
      </div>
    </div>
    <div className="story-layout-toolbar"><div className="story-scale" role="group" aria-label="Timeline layout"><button type="button" aria-pressed={fitted} onClick={() => setLayout('fit')}>Fit screen</button><button type="button" aria-pressed={!fitted} onClick={() => setLayout('scroll')}>Scroll</button></div><span>{fitted ? 'Full span fits here · crowded periods are grouped' : 'Full-size cards · scroll through time'}</span></div>
    {expanded && showFilters && <div className="story-expanded-filters">{filters}</div>}
    <div className="story-hint"><span>{periodItems.length} dated {periodItems.length === 1 ? 'moment' : 'moments'} · {scale === 'life' ? (isBusinessSpace ? 'Whole business history' : 'Whole recorded life') : scale === 'year' ? (slots < periodSlots ? 'Months grouped to fit' : 'One chapter per month') : `${monthName(month)} · ${slots < periodSlots ? 'Days grouped to fit' : 'One chapter per day'}`}</span><span>{fitted ? 'Select a chapter to explore its moments' : 'Swipe or scroll along the line'} <ArrowRight size={14} /></span></div>
    {yearOnly.length > 0 && <div className="story-loose"><span>During {year}</span>{yearOnly.map(item => <button type="button" key={item.id} className={`story-tag story-${item.category}`} aria-pressed={selected?.id === item.id} onClick={() => activate(item)}><GraduationCap size={14} />{item.title} · {item.dateLabel}</button>)}<small>Exact dates not recorded</small></div>}
    <div className="story-scroll" ref={scroller} tabIndex={0} aria-label="Scrollable timeline. Use left and right arrow keys to move." onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); scroll(event.key === 'ArrowRight' ? 1 : -1); } }}>
      <div className="story-canvas" style={{ width }}>
        <div className="story-spine" style={{ left: padding, right: padding }} />
        {scale === 'life' ? lifeTimelineTicks(firstYear, lastYear, width - padding * 2, fitted).map(tick => <button key={tick.year} type="button" className="story-tick story-year-tick" style={{ left: padding + tick.position * (width - padding * 2) }} aria-label={`Explore year ${tick.year}`} onClick={() => jumpToYear(tick.year)}><span>{tick.year}</span></button>) : Array.from({ length: slots }, (_, index) => <div key={index} className="story-tick" style={{ left: 60 + (index + 0.5) * slotWidth }}><span>{scale === 'year' ? monthName(Math.floor(index / slots * periodSlots)).slice(0, 3) : Math.floor(index / slots * periodSlots) + 1}</span></div>)}
        {chapters.map((chapter, index) => {
          const active = chapter.items.find(item => item.id === selected?.id);
          const lead = active || chapter.items.find(item => item.imageUrl) || chapter.items.find(item => ['memories', 'education', 'addresses', 'travel'].includes(item.category)) || chapter.items[0];
          const Icon = ICONS[lead.category];
          return <div key={chapter.key} className={`story-chapter ${index % 2 ? 'story-below' : 'story-above'} story-${lead.category} ${active ? 'story-selected' : ''}`} style={{ left: padding + (chapter.index + 0.5) * slotWidth }}>
            <div className="story-stem" /><div className="story-node"><Icon size={16} /></div>
            <button type="button" className="story-card" aria-pressed={!!active} aria-label={`${chapter.label}: ${lead.title}${chapter.items.length > 1 ? ` and ${chapter.items.length - 1} more` : ''}`} onClick={() => activate(lead, chapter.items.length > 1)}>
              {lead.imageUrl ? <img src={lead.imageUrl} alt="" loading="lazy" className="story-card-photo" /> : <div className="story-card-art"><Icon size={32} strokeWidth={1.3} /><span>{lead.sourceLabel}</span></div>}
              <div className="story-card-copy"><span className="story-card-date">{chapter.label}{chapter.items.length > 1 && <b>+{chapter.items.length - 1}</b>}</span><strong>{lead.title}</strong><small>{personNames(lead)}</small></div>
            </button>
          </div>;
        })}
        {!chapters.length && <p className="story-empty" style={{ left: (scroller.current?.scrollLeft || 0) + 40 }}>{scale === 'life' ? 'No dated moments match your filters. Add a moment or change your filters.' : `No dated moments in this ${scale}. Choose another ${scale} or add a moment.`}</p>}
      </div>
      {ranges.length > 0 && <div className="story-residences" style={{ width }}>{ranges.map(({ item, range }) => <div className="story-range-row" key={item.id}><button type="button" className="story-residence" style={{ left: padding + range!.start * (width - padding * 2), width: Math.max(10, (range!.end - range!.start) * (width - padding * 2)) }} onClick={() => activate(item)} aria-label={`${item.rangeLabel}, ${item.date} to ${item.endDate}`}><MapPin size={13} /><span>{item.rangeLabel}</span></button></div>)}</div>}
    </div>
    <div className="story-under-line"><span>Earlier <span aria-hidden="true">⟶</span> Later · {ranges.length ? 'Home bands show recorded residence dates' : 'Select a chapter to explore its moments'}</span><div><button type="button" className="story-icon-button" aria-label="Scroll timeline earlier" disabled={fitted} onClick={() => scroll(-1)}><ArrowLeft size={17} /></button><button type="button" className="story-icon-button" aria-label="Scroll timeline later" disabled={fitted} onClick={() => scroll(1)}><ArrowRight size={17} /></button></div></div>
    {selected && <div ref={detail} className={`story-detail story-${selected.category}`} aria-live="polite">
      <div className="story-detail-top"><span className="story-eyebrow">{selectedChapter ? `${selectedChapter.label} · ${selectedIndex + 1} of ${group.length}` : selected.date ? 'Chapter details' : 'Still part of your story'}</span><div className="story-detail-navigation"><button type="button" className="story-icon-button" aria-label="Previous moment in chapter" disabled={selectedIndex <= 0} onClick={() => select(group[selectedIndex - 1])}><ArrowLeft size={16} /></button><button type="button" className="story-icon-button" aria-label="Next moment in chapter" disabled={selectedIndex < 0 || selectedIndex >= group.length - 1} onClick={() => select(group[selectedIndex + 1])}><ArrowRight size={16} /></button></div></div>
      {renderDetails ? <>{scale === 'life' && selected.date && <button type="button" className="btn-primary text-xs mb-3" onClick={() => changeScale('year')}>Explore {selected.date.slice(0, 4)}<ArrowRight size={14} /></button>}{renderDetails(selected, document => { setExpanded(false); onOpenDocument?.(document); })}</> : <>      <div className="story-detail-body">{selected.imageUrl && <img src={selected.imageUrl} alt={selected.title} className="story-detail-photo" loading="lazy" />}<div className="story-detail-copy"><p className="story-detail-date">{dateLabel(selected)} · {selected.sourceLabel}</p><h3>{selected.title}</h3><p className="story-detail-person">{personNames(selected)}</p>{selected.note && <p className="story-detail-note">{selected.note}</p>}<div className="story-detail-actions">{scale === 'life' && selected.date && <button type="button" className="btn-primary text-xs" onClick={() => changeScale('year')}>Explore {selected.date.slice(0, 4)}<ArrowRight size={14} /></button>}{selected.target && onOpenRecord && <button type="button" className="btn-quiet text-xs" onClick={() => open(selected)}>Open {selected.sourceLabel.toLowerCase()}<ArrowUpRight size={14} /></button>}{selected.manual && onEdit && <button type="button" className="btn-quiet text-xs" onClick={() => { setExpanded(false); onEdit(selected.manual!); }}><Pencil size={14} />Edit moment</button>}{selected.manual && onDelete && <ConfirmDeleteButton disabled={busy} ariaLabel={`Delete ${selected.title}`} onConfirm={() => onDelete(selected.manual!)} />}</div></div></div></>}

      {group.length > 1 && <div className="story-siblings" aria-label="Moments in this chapter">{group.map(item => { const Icon = ICONS[item.category]; return <button key={item.id} type="button" className={`story-tag story-${item.category}`} aria-pressed={selected.id === item.id} onClick={() => activate(item)}><Icon size={14} />{item.title}</button>; })}</div>}
    </div>}
    {years.length > 0 && <div className="story-overview"><div className="story-overview-label"><span className="story-eyebrow">Your whole story</span><span>{firstYear === lastYear ? firstYear : `${firstYear} — ${lastYear}`} · drag to travel through years</span></div><div className="story-overview-track">{years.map(value => <span key={value} className={value === year ? 'is-current' : ''} style={{ left: `${lastYear === firstYear ? 50 : (value - firstYear) / (lastYear - firstYear) * 100}%`, height: Math.min(28, 5 + items.filter(item => item.date.startsWith(String(value))).length * 2) }} />)}<input type="range" min={firstYear} max={lastYear === firstYear ? lastYear + 1 : lastYear} disabled={firstYear === lastYear} value={year} step={1} aria-label="Travel through years" aria-valuetext={String(year)} onChange={event => jumpToYear(Number(event.target.value))} /></div></div>}
    {undated.length > 0 && <details className="story-undated"><summary>{undated.length} {undated.length === 1 ? 'moment without a date' : 'moments without dates'}</summary><p>Kept here until a date is recorded.</p><div className="story-siblings">{undated.map(item => <button type="button" key={item.id} className={`story-tag story-${item.category}`} aria-pressed={selected?.id === item.id} onClick={() => activate(item)}>{item.title}</button>)}</div></details>}
  </section>;
  return expanded ? createPortal(content, document.body) : content;
}
