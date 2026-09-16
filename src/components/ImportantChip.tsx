import { Star } from 'lucide-react';

/**
 * The "Important" marker on an event row. A word, not just a star: the star
 * alone reads as "favourite", and the chip sits next to "Alert on", which
 * means something else (see utils/importantEvents.ts for what decides it).
 */
export default function ImportantChip({ className = '' }: { className?: string }) {
  return (
    <span className={`chip shrink-0 bg-clay-100 text-clay-800 ring-1 ring-inset ring-clay-300 ${className}`}>
      <Star className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
      Important
    </span>
  );
}
