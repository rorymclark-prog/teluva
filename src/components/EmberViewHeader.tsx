import type { ElementType } from 'react';
import { ArrowRight, Heart, Home, Layers3, Map, ShieldCheck, Sparkles, Users } from 'lucide-react';

export interface EmberViewItem {
  id: string;
  label: string;
  icon: ElementType;
}

interface EmberViewHeaderProps {
  current: string;
  views: EmberViewItem[];
  onSelect: (id: string) => void;
}

type Destination = 'people' | 'plan' | 'house' | 'vault';

const destinations: Record<Destination, { label: string; icon: ElementType; ids: string[] }> = {
  people: {
    label: 'People',
    icon: Users,
    ids: ['profiles', 'emergency', 'info', 'timeline', 'familyWords', 'inMemory', 'familyTree', 'chat'],
  },
  plan: {
    label: 'Plan',
    icon: Map,
    ids: ['calendar', 'travelTimeline', 'recipes', 'shopping', 'gifts', 'anniversaries', 'extendedBirthdays'],
  },
  house: {
    label: 'House',
    icon: Home,
    ids: ['household', 'vehicles', 'pets', 'assets'],
  },
  vault: {
    label: 'Vault',
    icon: ShieldCheck,
    ids: ['vault', 'drive', 'finances', 'insurance', 'slips', 'passwords', 'willsEstate'],
  },
};

const copy: Record<string, { kicker: string; title: string; note: string }> = {
  profiles: { kicker: 'People · Living profiles', title: 'The family, at a glance.', note: 'Faces, relationships and what is happening in each person’s life right now.' },
  emergency: { kicker: 'People · Emergency', title: 'Useful with one hand.', note: 'The critical facts and trusted actions your family may need under pressure.' },
  info: { kicker: 'People · Important information', title: 'The facts close to hand.', note: 'Trusted contacts, providers and practical details without the folder hunt.' },
  timeline: { kicker: 'People · Family story', title: 'A year you can feel.', note: 'Dates, photographs and small family moments gathered into a living timeline.' },
  familyWords: { kicker: 'People · Family words', title: 'The language only you share.', note: 'Keep the sayings, nicknames and expressions that make this family itself.' },
  inMemory: { kicker: 'People · In memory', title: 'Quiet, lasting, family-owned.', note: 'A respectful place for a life story, voice and relationships across generations.' },
  familyTree: { kicker: 'People · Family tree', title: 'See how everyone connects.', note: 'Relationships, generations and imported family history in one calm map.' },
  chat: { kicker: 'People · Family chat', title: 'Keep the conversation together.', note: 'A private thread for the family decisions and moments that belong here.' },
  calendar: { kicker: 'Plan · Family horizon', title: 'The next seven days first.', note: 'People, preparation and the dates that shape the family’s week.' },
  travelTimeline: { kicker: 'Plan · Trips', title: 'The whole journey in one scene.', note: 'Itinerary, people, documents and memories connected around the trip.' },
  recipes: { kicker: 'Plan · Food', title: 'Dinner, decided.', note: 'Family recipes and useful context for the people gathering around the table.' },
  shopping: { kicker: 'Plan · Shopping', title: 'One list, already in order.', note: 'The practical things the household needs, grouped for the way you shop.' },
  gifts: { kicker: 'Plan · Gifts', title: 'Remember what would delight them.', note: 'Ideas, wishes and occasions kept with the person they belong to.' },
  anniversaries: { kicker: 'Plan · Celebrations', title: 'Make the lead-up feel special.', note: 'Dates, ideas, memories and small preparations for the rituals that matter.' },
  extendedBirthdays: { kicker: 'Plan · Wider family', title: 'Remember the whole circle.', note: 'Birthdays for grandparents, friends and everyone beyond the main household.' },
  household: { kicker: 'House · Home operations', title: 'Everything is settled.', note: 'Places, providers and home knowledge kept where the whole household can use it.' },
  vehicles: { kicker: 'House · Vehicles', title: 'Know what needs attention next.', note: 'Service history, documents and practical details attached to each vehicle.' },
  pets: { kicker: 'House · Pets', title: 'Care for every member of the family.', note: 'Health, routines and the details someone else would need to step in.' },
  assets: { kicker: 'House · Things', title: 'The important objects have a story.', note: 'Receipts, warranties, manuals and ownership attached to the thing itself.' },
  vault: { kicker: 'Vault · Documents', title: 'Find it in seconds.', note: 'Search, ownership, expiry and evidence—without guessing which folder won.' },
  drive: { kicker: 'Vault · Google Drive', title: 'Keep the source connected.', note: 'Bring existing family files into reach without creating another orphaned copy.' },
  finances: { kicker: 'Vault · Money records', title: 'Know what exists. Know who can act.', note: 'A calm index of accounts, responsibilities and the documents behind them.' },
  insurance: { kicker: 'Vault · Cover', title: 'Understand what protects the family.', note: 'Policies, people and claim moments connected in plain language.' },
  slips: { kicker: 'Vault · Purchase slips', title: 'Proof when you need it.', note: 'Receipts and purchase evidence ready for returns, warranties and claims.' },
  passwords: { kicker: 'Vault · Family access', title: 'Private means intentionally shared.', note: 'Sensitive access details with visible ownership and clear boundaries.' },
  willsEstate: { kicker: 'Vault · Estate & legacy', title: 'Start with the human note.', note: 'Wishes, responsibilities and the first things trusted people should know.' },
};

function destinationFor(viewId: string): Destination | null {
  return (Object.entries(destinations).find(([, destination]) => destination.ids.includes(viewId))?.[0] as Destination | undefined) || null;
}

export default function EmberViewHeader({ current, views, onSelect }: EmberViewHeaderProps) {
  const destinationId = destinationFor(current);
  const meta = copy[current];
  if (!destinationId || !meta) return null;

  const destination = destinations[destinationId];
  const available = destination.ids
    .map((id) => views.find((view) => view.id === id))
    .filter(Boolean) as EmberViewItem[];
  const DestinationIcon = destination.icon;

  return (
    <section className={`ember-view-heading ember-view-heading-${destinationId}`}>
      <div className="ember-view-heading-copy">
        <span className="ember-view-destination"><DestinationIcon className="h-3.5 w-3.5" />{meta.kicker}</span>
        <h1>{meta.title}</h1>
        <p>{meta.note}</p>
      </div>
      <div className="ember-view-mark" aria-hidden="true">
        {destinationId === 'people' ? <Heart /> : destinationId === 'plan' ? <Sparkles /> : destinationId === 'house' ? <Layers3 /> : <ShieldCheck />}
      </div>
      <nav className="ember-subnav" aria-label={`${destination.label} sections`}>
        {available.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => onSelect(id)} className={id === current ? 'is-active' : ''} aria-current={id === current ? 'page' : undefined}>
            <Icon className="h-3.5 w-3.5" /><span>{label}</span>{id === current && <ArrowRight className="h-3 w-3" />}
          </button>
        ))}
      </nav>
    </section>
  );
}
