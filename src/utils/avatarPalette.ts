// Warm v2 avatar palette. Maps legacy Tailwind color classes stored in member
// data (e.g. 'bg-blue-500') onto the new theme so old records render warmly.

export const AVATAR_COLORS = [
  'bg-clay-500',
  'bg-sage-500',
  'bg-dusk-500',
  'bg-rosa-500',
  'bg-honey-500',
  'bg-ink-600',
] as const;

const LEGACY_MAP: Record<string, string> = {
  'bg-blue-500': 'bg-dusk-500',
  'bg-blue-600': 'bg-dusk-500',
  'bg-sky-500': 'bg-dusk-500',
  'bg-indigo-500': 'bg-dusk-500',
  'bg-violet-500': 'bg-dusk-500',
  'bg-purple-500': 'bg-rosa-500',
  'bg-pink-500': 'bg-rosa-500',
  'bg-rose-500': 'bg-rosa-500',
  'bg-red-500': 'bg-clay-500',
  'bg-orange-500': 'bg-clay-500',
  'bg-amber-500': 'bg-honey-500',
  'bg-yellow-500': 'bg-honey-500',
  'bg-lime-500': 'bg-sage-500',
  'bg-green-500': 'bg-sage-500',
  'bg-emerald-500': 'bg-sage-500',
  'bg-teal-500': 'bg-sage-500',
  'bg-cyan-500': 'bg-dusk-500',
  'bg-gray-500': 'bg-ink-600',
  'bg-slate-500': 'bg-ink-600',
};

export function warmAvatarColor(stored?: string): string {
  if (!stored) return 'bg-clay-500';
  return LEGACY_MAP[stored] ?? stored;
}
