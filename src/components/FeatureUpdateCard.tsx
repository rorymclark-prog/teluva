import FeatureUpdatePreview from './FeatureUpdatePreview';
import type { FeatureUpdate } from '../utils/featureUpdates';

export default function FeatureUpdateCard({ feature }: { feature: FeatureUpdate }) {
  return <article className="overflow-hidden rounded-3xl border border-cream-300 bg-cream-50 text-ink-800">
    <FeatureUpdatePreview />
    <div className="px-5 pb-5">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-clay-700">Feature spotlight</p>
      <h3 className="text-xl font-bold leading-tight">{feature.title}</h3>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-600">{feature.description}</p>
    </div>
  </article>;
}
