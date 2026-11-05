export interface FeatureUpdate {
  id: string;
  demo: 'family-memories';
  title: string;
  description: string;
}

/** Only known demonstrations can be rendered from a fetched changelog. */
export function cleanFeatureUpdate(value: unknown): FeatureUpdate | null {
  if (!value || typeof value !== 'object') return null;
  const f = value as Record<string, unknown>;
  if (f.demo !== 'family-memories' || typeof f.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(f.id)
    || typeof f.title !== 'string' || !f.title.trim() || f.title.length > 160
    || typeof f.description !== 'string' || !f.description.trim() || f.description.length > 800) return null;
  return { id: f.id, demo: f.demo, title: f.title, description: f.description };
}
