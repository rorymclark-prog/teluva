import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Check, CheckCheck, Circle, ClipboardList, Loader2, Pencil, Plus, Search, X } from 'lucide-react';
import type { FamilyAction, FamilyMember } from '../types';
import { actionCounts, actionDaysUntil, actionOwnerFilterPeople, actionOwnerName, actionSourceAvailable, buildActionSuggestions, createActionFromSuggestion, filterActions, setActionStatus, type ActionDirectoryStatus, type ActionFilters, type ActionPerson } from '../utils/actions';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import './FamilyActions.css';

interface Props {
  members: FamilyMember[];
  ownerPeople?: readonly ActionPerson[];
  ownerDirectoryStatus?: ActionDirectoryStatus;
  onRetryOwnerDirectory?: () => void;
  actions: FamilyAction[];
  loading: boolean;
  saving: boolean;
  pendingRemote: boolean;
  notice: string;
  canEdit: boolean;
  demo: boolean;
  isBusinessSpace: boolean;
  createSignal: number;
  onCreateHandled: () => void;
  onSave: (items: FamilyAction[]) => Promise<boolean>;
  onOpenSource: (source: NonNullable<FamilyAction['source']>) => void;
  onEditingChange: (editing: boolean) => void;
}

export function actionDueLabel(date?: string): string {
  const days = actionDaysUntil(date);
  if (days === null) return 'No due date';
  if (days < 0) return `${Math.abs(days)} ${days === -1 ? 'day' : 'days'} overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due ${new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00`))}`;
}

function freshAction(): FamilyAction {
  const stamp = new Date().toISOString();
  return { id: crypto.randomUUID(), title: '', status: 'open', createdAt: stamp, updatedAt: stamp };
}

export default function FamilyActions({ members, ownerPeople = members, ownerDirectoryStatus = 'ready', onRetryOwnerDirectory, actions, loading, saving, pendingRemote, notice, canEdit, demo, isBusinessSpace, createSignal, onCreateHandled, onSave, onOpenSource, onEditingChange }: Props) {
  const [draft, setDraft] = useState<FamilyAction | null>(null);
  const [relatedPerson, setRelatedPerson] = useState('');
  const [filters, setFilters] = useState<ActionFilters>({ status: 'open', due: 'all' });
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const counts = actionCounts(actions);
  const suggestions = useMemo(() => buildActionSuggestions(members, actions)
    .filter(item => !isBusinessSpace || !['education', 'medical'].includes(item.source.tab || '')), [members, actions, isBusinessSpace]);
  const visible = filterActions(actions, filters);
  const existing = draft ? actions.some(action => action.id === draft.id) : false;
  const editing = !!draft && canEdit;
  useBodyScrollLock(editing);

  useLayoutEffect(() => { onEditingChange(editing); return () => onEditingChange(false); }, [editing, onEditingChange]);
  useEffect(() => {
    if (!createSignal) return;
    if (canEdit && !draft) { setDraft(freshAction()); setRelatedPerson(''); }
    onCreateHandled();
  }, [createSignal, canEdit, onCreateHandled]);
  useEffect(() => {
    if (!editing) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = [...document.body.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child !== dialogRef.current?.parentElement);
    const oldInert = background.map(element => element.inert);
    background.forEach(element => { element.inert = true; });
    titleRef.current?.focus();
    return () => {
      background.forEach((element, index) => { element.inert = oldInert[index]; });
      previousFocus.current?.focus();
    };
  }, [editing]);

  const close = () => { if (!saving) setDraft(null); };
  const dialogKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if (event.key !== 'Tab') return;
    const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)') || [])];
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !canEdit || !draft.title.trim() || saving || loading) return;
    if (draft.dueDate && actionDaysUntil(draft.dueDate) === null) return;
    const next: FamilyAction = { ...draft, title: draft.title.trim(), notes: draft.notes?.trim() || '', updatedAt: new Date().toISOString() };
    if (!next.source && relatedPerson) {
      const member = members.find(person => person.id === relatedPerson);
      if (member) next.source = { key: `manual:${next.id}`, label: `${member.name}'s profile`, memberId: member.id, tab: 'overview' };
    }
    // Stable ids are also used for suggestion-derived actions, so two phones
    // reviewing the same suggestion converge instead of creating duplicates.
    const items = actions.some(item => item.id === next.id)
      ? actions.map(item => item.id === next.id ? next : item) : [...actions, next];
    if (await onSave(items)) setDraft(null);
  };
  const toggle = async (action: FamilyAction) => {
    if (!canEdit || saving) return;
    await onSave(actions.map(item => item.id === action.id ? setActionStatus(item, item.status === 'open' ? 'done' : 'open') : item));
  };
  const directoryAvailable = ownerDirectoryStatus === 'ready';
  const ownerName = (action: FamilyAction) => actionOwnerName(action, ownerPeople, isBusinessSpace, directoryAvailable);
  const filterPeople = actionOwnerFilterPeople(ownerPeople, actions, isBusinessSpace, directoryAvailable);

  return (
    <section className="family-actions card" aria-labelledby="actions-title" aria-busy={loading || saving}>
      <header className="actions-heading">
        <span className="actions-heading-icon"><ClipboardList size={21} aria-hidden="true" /></span>
        <div><span className="actions-eyebrow">A next step, together</span><h2 id="actions-title">Actions <span>{counts.open}</span></h2></div>
        {canEdit && <button type="button" className="btn-primary actions-add" onClick={() => { setDraft(freshAction()); setRelatedPerson(''); }} disabled={loading || saving}><Plus size={16} /> Add action</button>}
      </header>
      <p className="actions-intro">Give the next step an owner and a date. {demo ? 'Try it here; sample changes last for this session.' : `Shared with everyone in this ${isBusinessSpace ? 'business' : 'family'} space.`}</p>
      <div className="actions-summary" aria-label="Action summary">
        <button type="button" className={filters.due === 'overdue' ? 'is-selected' : ''} onClick={() => setFilters({ ...filters, status: 'open', due: filters.due === 'overdue' ? 'all' : 'overdue' })}><b>{counts.overdue}</b> overdue</button>
        <button type="button" className={filters.due === 'soon' ? 'is-selected' : ''} onClick={() => setFilters({ ...filters, status: 'open', due: filters.due === 'soon' ? 'all' : 'soon' })}><b>{counts.dueSoon}</b> this week</button>
        <span><CheckCheck size={15} /> {counts.done} completed</span>
      </div>
      <div className="actions-toolbar">
        <div className="actions-tabs" role="group" aria-label="Action status">
          {(['open', 'done', 'all'] as const).map(status => <button key={status} type="button" aria-pressed={filters.status === status} onClick={() => setFilters({ ...filters, status, due: 'all' })}>{status === 'done' ? 'Completed' : status === 'all' ? 'All' : 'Open'}</button>)}
        </div>
        <label className="actions-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search actions" placeholder="Find an action…" value={filters.search || ''} onChange={event => setFilters({ ...filters, search: event.target.value })} /></label>
        <select aria-label="Filter actions by owner" value={filters.ownerMemberId || ''} onChange={event => setFilters({ ...filters, ownerMemberId: event.target.value })}>
          <option value="">Everyone</option><option value="unassigned">Unassigned</option>
          {filterPeople.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select>
      </div>
      {pendingRemote && <p className="actions-notice" role="status">Someone else updated Actions. Their changes will appear when you close this form.</p>}
      {notice && <p className="actions-notice" role="status">{notice}</p>}
      {isBusinessSpace && ownerDirectoryStatus === 'unavailable' && <p className="actions-notice" role="status">Team names could not be loaded. Existing assignments are kept; you can still choose from the people available here. {onRetryOwnerDirectory && <button type="button" className="underline underline-offset-2" onClick={onRetryOwnerDirectory}>Retry team directory</button>}</p>}
      {loading ? <p className="actions-empty"><Loader2 size={18} className="animate-spin" /> Loading actions…</p> : (
        <div className="actions-list" aria-live="polite">
          {visible.length ? visible.map(action => <article className={`action-row ${action.status === 'done' ? 'is-done' : ''}`} key={action.id}>
            <button type="button" className="action-check" role="checkbox" aria-checked={action.status === 'done'} aria-label={`${action.status === 'done' ? 'Reopen' : 'Complete'} ${action.title}`} disabled={!canEdit || saving} onClick={() => toggle(action)}>{action.status === 'done' ? <Check size={18} /> : <Circle size={21} />}</button>
            <div className="action-row-body"><h3>{action.title}</h3>{action.notes && <p>{action.notes}</p>}<div className="action-meta"><span>{ownerName(action)}</span><span className={action.status === 'open' && (actionDaysUntil(action.dueDate) ?? 0) < 0 ? 'is-overdue' : ''}>{action.status === 'done' ? 'Completed' : actionDueLabel(action.dueDate)}</span>
              {action.source && (actionSourceAvailable(action, members) ? <button type="button" onClick={() => onOpenSource(action.source!)}>{action.source.label}<ArrowUpRight size={12} /></button> : <span>{isBusinessSpace ? 'Private team record' : 'Source no longer available'}</span>)}
            </div></div>
            {canEdit && <button type="button" className="action-edit" aria-label={`Edit ${action.title}`} disabled={saving} onClick={() => { setDraft({ ...action }); setRelatedPerson(''); }}><Pencil size={15} /></button>}
          </article>) : <div className="actions-empty"><ClipboardList size={25} /><div><b>{actions.length ? 'No actions match this view.' : 'Make room for the next step.'}</b><p>{actions.length ? 'Try a different owner, status or search.' : 'Add an action or review a suggestion from your records below.'}</p></div></div>}
        </div>
      )}
      {canEdit && suggestions.length > 0 && !loading && <div className="actions-suggestions">
        <div><span className="actions-eyebrow">From your records</span><h3>Turn a reminder into a plan</h3><p>Review the owner and due date before adding. No action is created automatically.</p></div>
        {(showAllSuggestions ? suggestions : suggestions.slice(0, 3)).map(suggestion => <div className="action-suggestion" key={suggestion.key}><div><b>{suggestion.title}</b><small>{suggestion.dueDate ? `Recorded expiry · ${suggestion.dueDate}` : 'Choose a due date when you review'}</small></div><button type="button" disabled={saving} onClick={() => {
          setDraft(createActionFromSuggestion(suggestion, { id: `record:${suggestion.key}` })); setRelatedPerson('');
        }}>Review <Plus size={14} /></button></div>)}
        {suggestions.length > 3 && <button type="button" className="actions-show-all" onClick={() => setShowAllSuggestions(!showAllSuggestions)}>{showAllSuggestions ? 'Show fewer' : `See all ${suggestions.length} suggestions`}</button>}
      </div>}
      <footer className="actions-footnote">Completing an action closes the task. Update the linked record separately when something changes.</footer>

      {draft && canEdit && createPortal(<div className="actions-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
        <div ref={dialogRef} className="actions-dialog" role="dialog" aria-modal="true" aria-labelledby="action-editor-title" aria-describedby="action-editor-note" onKeyDown={dialogKeys}>
          <header><div><span className="actions-eyebrow">One clear next step</span><h2 id="action-editor-title">{existing ? 'Edit action' : 'Add action'}</h2></div><button type="button" aria-label="Close action editor" disabled={saving} onClick={close}><X size={20} /></button></header>
          <p id="action-editor-note">Visible to everyone in this space. Keep passwords and private access instructions in their protected records.</p>
          <form onSubmit={save}>
            <label>What needs doing?<input ref={titleRef} required maxLength={180} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder={isBusinessSpace ? 'e.g. Confirm next month’s team roster' : 'e.g. Return the school form'} disabled={saving} /></label>
            <label>Next step or notes<textarea maxLength={2000} rows={3} value={draft.notes || ''} onChange={event => setDraft({ ...draft, notes: event.target.value })} placeholder="What will help someone finish this?" disabled={saving} /></label>
            <div className="actions-form-pair"><label>Owner<select value={draft.ownerMemberId || ''} onChange={event => setDraft({ ...draft, ownerMemberId: event.target.value })} disabled={saving}><option value="">Unassigned</option>{draft.ownerMemberId && !ownerPeople.some(person => person.id === draft.ownerMemberId) && <option value={draft.ownerMemberId}>{ownerName(draft)}</option>}{ownerPeople.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label>Due date <span>(optional)</span><input type="date" value={draft.dueDate || ''} onChange={event => setDraft({ ...draft, dueDate: event.target.value })} disabled={saving} /></label></div>
            {draft.source ? <div className="actions-source-note">Linked record: <b>{draft.source.label}</b><p>Opening or completing this action does not change that record.</p></div> : <label>Related person <span>(optional)</span><select value={relatedPerson} onChange={event => setRelatedPerson(event.target.value)} disabled={saving}><option value="">General action</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}
            {notice && <p role="status" className="actions-notice">{notice}</p>}
            <footer>{existing && <ConfirmDeleteButton ariaLabel={`Remove ${draft.title}`} hint="Removes the action only. The linked record stays." variant="danger-text" disabled={saving} onConfirm={async () => { if (await onSave(actions.filter(item => item.id !== draft.id))) setDraft(null); }}>Remove</ConfirmDeleteButton>}<button className="actions-cancel" type="button" onClick={close} disabled={saving}>Cancel</button><button type="submit" className="btn-primary" disabled={saving || loading || !draft.title.trim()}>{saving && <Loader2 size={15} className="animate-spin" />} {existing ? 'Save changes' : 'Add action'}</button></footer>
          </form>
        </div>
      </div>, document.body)}
    </section>
  );
}
