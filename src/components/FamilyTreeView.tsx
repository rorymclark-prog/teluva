import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DepartedRelative, ExtendedBirthday, FamilyMember, KinLink, KinRef } from '../types';
import {
  loadFamilyMembers, loadExtendedBirthdays, loadInMemory, loadFamilyTree,
  saveExtendedBirthdays, saveFamilyTree, saveInMemory,
} from '../utils/db';
import {
  KinPerson, buildKinGraph, childrenOf, describeKinLink, findKinCycles,
  generations, kinLifespan, kinLinkProblem, kinName, parentsOf, partnersOf, siblingsOf,
} from '../utils/kin';
import { gedcomFilename, gedcomSummary, toGedcom } from '../utils/gedcom';
import { GedcomImportResult, importSummary, planGedcomImport } from '../utils/gedcomImport';
import EmptyState from './EmptyState';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import {
  Network, Plus, Check, X, Download, Upload, Users, Flower2, Cake, AlertTriangle, Info, Link2,
} from 'lucide-react';

// The family tree.
//
// WHAT THIS SCREEN IS FOR: the people in this vault span three separate lists
// — the household, Extended Birthdays (grandparents, aunts, godparents) and
// In Memory (the departed) — and until now nothing said how any of them were
// related. `role` is a household role: in a house with two children, "Child"
// is true of both and connects neither to anyone.
//
// ONE ROW PER GENERATION, everyone else beside them. Not a drawn tree with
// curved connectors: on a phone that is either unreadable or needs pan-and-
// zoom, and this app is used on a phone. Rows with a named relationship under
// each person carry the same information and can be read at a glance.
//
// The whole thing is centred on ONE person at a time, which is also how a
// family tree is actually used — "show me Maya's side" — and it means a vault
// with two unconnected halves shows each of them properly instead of one
// tangle.

const newId = () => Date.now().toString() + Math.floor(Math.random() * 1000);

const KIND_TONE: Record<string, string> = {
  member: 'bg-clay-100 text-clay-700',
  extended: 'bg-honey-100 text-honey-800',
  memory: 'bg-cream-200 text-ink-500',
};

const KIND_ICON: Record<string, React.ElementType> = {
  member: Users,
  extended: Cake,
  memory: Flower2,
};

interface PersonChipProps { p: KinPerson; active?: boolean; onClick?: () => void }

const PersonChip: React.FC<PersonChipProps> = ({ p, active, onClick }) => {
  const Icon = KIND_ICON[p.kind] || Users;
  const life = kinLifespan(p);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 rounded-2xl border transition-colors min-w-[9.5rem] ${
        active ? 'border-clay-400 bg-clay-50 ring-1 ring-clay-300' : 'border-cream-200 bg-white hover:bg-cream-50 hover:border-cream-300'
      }`}
    >
      <span className="flex items-center gap-1.5">
        <span className={`p-1 rounded-lg shrink-0 ${KIND_TONE[p.kind]}`}><Icon className="w-3 h-3" /></span>
        <span className="text-[13px] font-semibold text-ink-900 truncate">{p.name || 'Unnamed'}</span>
      </span>
      {(life || p.relation) && (
        <span className="block text-[11px] text-ink-500 mt-0.5 truncate">
          {[p.relation, life].filter(Boolean).join(' · ')}
        </span>
      )}
    </button>
  );
};

interface RowProps {
  title: string;
  refs: KinRef[];
  index: Map<KinRef, KinPerson>;
  focus: KinRef;
  onPick: (r: KinRef) => void;
}

const Row: React.FC<RowProps> = ({ title, refs, index, focus, onPick }) => {
  if (!refs.length) return null;
  return (
    <div className="space-y-1.5">
      <h4 className="section-label">{title}</h4>
      <div className="flex flex-wrap gap-2">
        {refs.map(r => {
          const p = index.get(r);
          if (!p) return null;
          return <PersonChip key={r} p={p} active={r === focus} onClick={() => onPick(r)} />;
        })}
      </div>
    </div>
  );
};

export default function FamilyTreeView({ refreshKey }: { refreshKey?: number }) {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [extended, setExtended] = useState<ExtendedBirthday[]>([]);
  const [departed, setDeparted] = useState<DepartedRelative[]>([]);
  const [links, setLinks] = useState<KinLink[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [focus, setFocus] = useState<KinRef | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<GedcomImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      // All THREE person stores. Loading only members would produce a "family
      // tree" that stops at the front door.
      const [m, e, mem, l] = await Promise.all([
        loadFamilyMembers().catch(() => []),
        loadExtendedBirthdays().catch(() => []),
        loadInMemory().catch(() => null),
        loadFamilyTree().catch(() => []),
      ]);
      if (!active) return;
      setMembers(m || []);
      setExtended(e || []);
      setDeparted(mem?.people || []);
      setLinks(l || []);
      setLoaded(true);
    })();
    return () => { active = false; };
  }, [refreshKey]);

  const graph = useMemo(
    () => buildKinGraph({ members, extendedBirthdays: extended, inMemory: departed }, links),
    [members, extended, departed, links],
  );

  // Default to the first household member — the person most likely holding the
  // phone — but never override a choice already made.
  useEffect(() => {
    if (!loaded || focus) return;
    setFocus(graph.people[0]?.ref || null);
  }, [loaded, focus, graph.people]);

  const persist = useCallback(async (next: KinLink[]) => {
    setLinks(next);
    await saveFamilyTree(next);
  }, []);

  const addLink = async (l: Omit<KinLink, 'id' | 'createdAt'>) => {
    const problem = kinLinkProblem(l, graph);
    if (problem) { setError(problem); return false; }
    setError(null);
    await persist([...links, { ...l, id: newId(), createdAt: new Date().toISOString().slice(0, 10) }]);
    setAdding(false);
    return true;
  };

  const removeLink = (id: string) => persist(links.filter(l => l.id !== id));

  const exportGedcom = () => {
    const text = toGedcom(graph, { appVersion: 'v250', familyLabel: 'Family', todayISO: new Date().toLocaleDateString('en-CA') });
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = gedcomFilename('Family');
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // --- Importing a tree from somewhere else ---
  //
  // Read, plan, SHOW, and only then write. This is the one action in the app
  // that can add a hundred records in a tap, and a family who has just watched
  // it happen to their vault has no way to undo it — so the preview is not
  // politeness, it is the safety mechanism.
  const chooseFile = async (file: File | null | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      setPending(planGedcomImport(text, {
        members, extendedBirthdays: extended, inMemory: departed, links,
      }));
    } catch {
      setError('That file could not be read.');
    }
    // Clear the input so choosing the same file twice still fires a change.
    if (fileInput.current) fileInput.current.value = '';
  };

  const confirmImport = async () => {
    if (!pending || pending.plan.refusal) return;
    setImporting(true);
    try {
      // Order matters: the people have to exist before the links that name
      // them, or a reader between the two writes sees edges into thin air.
      if (pending.extendedBirthdays.length > extended.length) {
        await saveExtendedBirthdays(pending.extendedBirthdays, extended);
      }
      if (pending.inMemory.length > departed.length) {
        await saveInMemory({ people: pending.inMemory }, { people: departed });
      }
      if (pending.links.length > links.length) {
        await saveFamilyTree(pending.links, links);
      }
      setExtended(pending.extendedBirthdays);
      setDeparted(pending.inMemory);
      setLinks(pending.links);
      setPending(null);
    } catch {
      setError('The import could not be saved. Nothing was changed.');
    } finally {
      setImporting(false);
    }
  };

  if (!loaded) {
    return (
      <div className="card flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-clay-500" />
      </div>
    );
  }

  const summary = gedcomSummary(graph);
  const cycles = findKinCycles(graph);
  const gen = focus ? generations(graph, focus) : new Map<KinRef, number>();
  const focusLinks = focus
    ? graph.links.filter(l => l.from === focus || l.to === focus)
    : [];

  return (
    <div className="space-y-6 font-sans">
      <div className="card p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-2xl bg-clay-100 text-clay-700 shrink-0">
              <Network className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-semibold text-ink-900">Family tree</h2>
              <p className="text-[13px] text-ink-500 font-medium">
                Who belongs to whom — across the family, extended birthdays and In Memory.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => fileInput.current?.click()}
              className="btn-quiet text-xs px-3 py-1.5"
              title="Import a GEDCOM file"
            >
              <Upload className="w-3.5 h-3.5" /> Import
            </button>
            {graph.people.length > 0 && (
              <button onClick={exportGedcom} className="btn-quiet text-xs px-3 py-1.5" title="Export as a GEDCOM file">
                <Download className="w-3.5 h-3.5" /> Export
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".ged,.gedcom,text/plain"
            className="hidden"
            onChange={e => chooseFile(e.target.files?.[0])}
          />
        </div>
      </div>

      {pending && <ImportPreview result={pending} busy={importing} onConfirm={confirmImport} onCancel={() => setPending(null)} />}

      {error && !adding && (
        <div className="card p-4 border-rosa-300 bg-rosa-50/60">
          <p className="text-[13px] text-rosa-700">{error}</p>
        </div>
      )}

      {graph.people.length === 0 ? (
        <div className="card p-5">
          <EmptyState
            icon={Network}
            title="Nobody to connect yet"
            description="The tree is built from the people already in this vault — the family, Extended Birthdays and In Memory. Add someone in one of those, then come back and draw the lines."
          />
        </div>
      ) : (
        <>
          {cycles.length > 0 && (
            <div className="card p-4 border-rosa-300 bg-rosa-50/60">
              <p className="text-[13px] font-semibold text-rosa-700 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> Someone is recorded as their own ancestor
              </p>
              <p className="text-[12px] text-ink-600 mt-1">
                {cycles.map(r => kinName(r, graph.index)).join(', ')} — one of their parent links is the wrong way round.
                Remove it below and add it again the other way.
              </p>
            </div>
          )}

          {/* Who the tree is drawn around */}
          <section className="card p-5 space-y-3">
            <h3 className="section-label flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Everyone in the vault</h3>
            <div className="flex flex-wrap gap-2">
              {graph.people.map(p => (
                <PersonChip key={p.ref} p={p} active={p.ref === focus} onClick={() => setFocus(p.ref)} />
              ))}
            </div>
            <p className="text-[11px] text-ink-400 flex items-center gap-1">
              <Info className="w-3 h-3" /> Tap anyone to see the tree from where they stand.
            </p>
          </section>

          {focus && (
            <section className="card p-5 space-y-5">
              <div className="flex items-center justify-between gap-3 pb-3 border-b border-cream-200">
                <h3 className="section-label truncate">Around {kinName(focus, graph.index)}</h3>
                <button onClick={() => { setAdding(true); setError(null); }} className="btn-primary text-xs px-3 py-1.5 shrink-0">
                  <Plus className="w-3.5 h-3.5" /> Add a link
                </button>
              </div>

              {adding && (
                <AddLinkForm
                  people={graph.people}
                  defaultFrom={focus}
                  error={error}
                  onCancel={() => { setAdding(false); setError(null); }}
                  onSave={addLink}
                />
              )}

              <Row title="Grandparents" refs={[...gen.keys()].filter(r => gen.get(r) === -2)} index={graph.index} focus={focus} onPick={setFocus} />
              <Row title="Parents" refs={parentsOf(graph, focus)} index={graph.index} focus={focus} onPick={setFocus} />
              <Row title="Partner" refs={partnersOf(graph, focus)} index={graph.index} focus={focus} onPick={setFocus} />
              <Row title="Brothers & sisters" refs={siblingsOf(graph, focus)} index={graph.index} focus={focus} onPick={setFocus} />
              <Row title="Children" refs={childrenOf(graph, focus)} index={graph.index} focus={focus} onPick={setFocus} />
              <Row title="Grandchildren" refs={[...gen.keys()].filter(r => gen.get(r) === 2)} index={graph.index} focus={focus} onPick={setFocus} />

              {focusLinks.length === 0 && !adding && (
                <EmptyState
                  icon={Link2}
                  title="No connections yet"
                  description="Add a link to say who their parents, children or partner are. Brothers, sisters and grandparents work themselves out from that."
                  size="sm"
                />
              )}

              {focusLinks.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <h4 className="section-label">Links recorded here</h4>
                  {focusLinks.map(l => (
                    <div key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl border border-cream-200 bg-white">
                      <div className="min-w-0">
                        <p className="text-[12.5px] text-ink-800 truncate">{describeKinLink(l, graph.index)}</p>
                        {l.derivedFrom && (
                          <p className="text-[11px] text-ink-400 truncate">From {l.derivedFrom} — change it there</p>
                        )}
                      </div>
                      {/* A derived link has no delete: it would come straight
                          back on the next render, because the profile still
                          says it. Saying where it comes from is the honest
                          answer, and it is one tap away. */}
                      {!l.derivedFrom && (
                        <ConfirmDeleteButton
                          onConfirm={() => removeLink(l.id)}
                          ariaLabel={`Remove link: ${describeKinLink(l, graph.index)}`}
                          confirmLabel="Remove"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="card p-5 space-y-2">
            <h3 className="section-label flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Taking it elsewhere</h3>
            <p className="text-[12.5px] text-ink-600">
              Export writes a GEDCOM file — the format Ancestry, MyHeritage, FamilySearch, Geni and Gramps all
              read. {summary.people} {summary.people === 1 ? 'person' : 'people'}, {summary.families}{' '}
              {summary.families === 1 ? 'family' : 'families'}.
            </p>
            {summary.unlinked.length > 0 && (
              <p className="text-[12px] text-honey-800">
                Not connected to anyone yet, so they will export on their own: {summary.unlinked.join(', ')}.
              </p>
            )}
            <p className="text-[12.5px] text-ink-600">
              Import reads one back in. Anyone already in this vault is recognised by name and left as they
              are — the file's connections attach to the records you already have, rather than making second
              copies of everybody. You see exactly what it will add before anything is saved.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

/* ─── The import preview ──────────────────────────────────────────────────── */

const ACTION_TONE: Record<string, string> = {
  'new-extended': 'text-honey-800 bg-honey-50 border-honey-200',
  'new-memory': 'text-ink-500 bg-cream-100 border-cream-300',
  matched: 'text-clay-700 bg-clay-50 border-clay-200',
  ambiguous: 'text-rosa-700 bg-rosa-50 border-rosa-200',
};

interface ImportPreviewProps {
  result: GedcomImportResult;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ImportPreview: React.FC<ImportPreviewProps> = ({ result, busy, onConfirm, onCancel }) => {
  const { plan } = result;

  if (plan.refusal) {
    return (
      <section className="card p-5 border-rosa-300 bg-rosa-50/50 space-y-3">
        <h3 className="section-label flex items-center gap-1.5 text-rosa-700">
          <AlertTriangle className="w-3.5 h-3.5" /> That file could not be imported
        </h3>
        <p className="text-[13px] text-ink-700">{plan.refusal}</p>
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5">Close</button>
      </section>
    );
  }

  const blocked = plan.links.filter(l => l.action === 'blocked');
  const nothingToDo = plan.counts.newPeople === 0 && plan.counts.newLinks === 0;

  return (
    <section className="card p-5 space-y-4 border-clay-300 ring-1 ring-clay-200">
      <div>
        <h3 className="section-label flex items-center gap-1.5"><Upload className="w-3.5 h-3.5" /> Before this is saved</h3>
        <p className="text-[13px] text-ink-700 mt-1">
          {nothingToDo
            ? 'Everything in that file is already in this vault. Nothing to add.'
            : `This will add ${importSummary(plan)}. Nothing has been written yet.`}
        </p>
      </div>

      {plan.warnings.map((w, i) => (
        <p key={i} className="text-[12px] text-honey-800 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {w}
        </p>
      ))}

      {plan.people.length > 0 && (
        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {plan.people.map(p => (
            <div key={p.xref} className={`px-3 py-2 rounded-xl border ${ACTION_TONE[p.action] || 'border-cream-200 bg-white'}`}>
              <p className="text-[12.5px] font-medium text-ink-800 truncate">{p.name}</p>
              <p className="text-[11px] text-ink-500">{p.detail}</p>
            </div>
          ))}
        </div>
      )}

      {/* A refused connection is the thing most worth reading here, so it gets
          its own block rather than being one row among ninety. */}
      {blocked.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-cream-200">
          <h4 className="section-label text-rosa-700">
            {blocked.length} connection{blocked.length === 1 ? '' : 's'} left out
          </h4>
          {blocked.slice(0, 8).map((l, i) => (
            <p key={i} className="text-[11.5px] text-ink-600">
              <span className="text-ink-800">{l.label}</span> — {l.reason}
            </p>
          ))}
          {blocked.length > 8 && (
            <p className="text-[11.5px] text-ink-400">…and {blocked.length - 8} more.</p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button onClick={onConfirm} disabled={busy || nothingToDo} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50">
          <Check className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Add these'}
        </button>
        <button onClick={onCancel} disabled={busy} className="btn-quiet text-xs px-3 py-1.5">
          <X className="w-3.5 h-3.5" /> {nothingToDo ? 'Close' : 'Cancel'}
        </button>
      </div>
    </section>
  );
};

/* ─── Adding a link ───────────────────────────────────────────────────────── */

function AddLinkForm({ people, defaultFrom, error, onCancel, onSave }: {
  people: KinPerson[];
  defaultFrom: KinRef;
  error: string | null;
  onCancel: () => void;
  onSave: (l: Omit<KinLink, 'id' | 'createdAt'>) => void;
}) {
  // Phrased as a sentence rather than three labelled dropdowns, because "X is
  // the parent of Y" is unambiguous and "from / to / kind" is not — with a
  // reversed parent link being both the easiest mistake to make and the one
  // that produces a tree with no top.
  const [kind, setKind] = useState<'parent' | 'partner'>('parent');
  const [from, setFrom] = useState<KinRef>(defaultFrom);
  const [to, setTo] = useState<KinRef>('');
  const [via, setVia] = useState<KinLink['via']>('birth');
  const [status, setStatus] = useState<KinLink['status']>('married');

  const options = people.map(p => (
    <option key={p.ref} value={p.ref}>{p.name || 'Unnamed'}{p.relation ? ` (${p.relation})` : ''}</option>
  ));

  return (
    <div className="p-4 rounded-2xl border border-cream-300 bg-cream-50/70 space-y-3">
      <div className="flex gap-2">
        {(['parent', 'partner'] as const).map(k => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`text-xs px-3 py-1.5 rounded-full border font-semibold ${
              kind === k ? 'bg-clay-500 text-white border-clay-500' : 'bg-white text-ink-600 border-cream-300'
            }`}
          >
            {k === 'parent' ? 'Parent & child' : 'Partners'}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div>
          <label className="field-label">{kind === 'parent' ? 'Who is the parent?' : 'One of them'}</label>
          <select className="field" value={from} onChange={e => setFrom(e.target.value)}>
            <option value="">Choose someone…</option>
            {options}
          </select>
        </div>
        <div>
          <label className="field-label">{kind === 'parent' ? 'Whose parent are they?' : 'And the other'}</label>
          <select className="field" value={to} onChange={e => setTo(e.target.value)}>
            <option value="">Choose someone…</option>
            {options}
          </select>
        </div>

        {kind === 'parent' ? (
          <div>
            <label className="field-label">How</label>
            <select className="field" value={via} onChange={e => setVia(e.target.value as KinLink['via'])}>
              <option value="birth">Birth parent</option>
              <option value="adoptive">Adoptive parent</option>
              <option value="step">Step-parent</option>
              <option value="foster">Foster parent</option>
            </select>
          </div>
        ) : (
          <div>
            <label className="field-label">Where it stands</label>
            <select className="field" value={status} onChange={e => setStatus(e.target.value as KinLink['status'])}>
              <option value="married">Married</option>
              <option value="partner">Partners</option>
              <option value="divorced">Divorced</option>
              <option value="widowed">Widowed</option>
            </select>
          </div>
        )}
      </div>

      {error && <p role="alert" className="text-[12px] text-rosa-600">{error}</p>}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button
          onClick={() => onSave(kind === 'parent' ? { kind, from, to, via } : { kind, from, to, status })}
          className="btn-primary text-xs px-3 py-1.5"
        >
          <Check className="w-3.5 h-3.5" /> Save
        </button>
      </div>
    </div>
  );
}
