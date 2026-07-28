import { Phone, Siren } from 'lucide-react';
import type { IdCountry } from '../types';
import { getEmergencyNumbers } from '../utils/emergencyNumbers';

// SAFETY-CRITICAL: the national emergency numbers, rendered as large, single-
// tap `tel:` links. Meant to be the very first thing a panicking babysitter,
// visiting relative, or first responder sees — above any personal/family
// contact info, never behind a tap or a dropdown. See src/utils/emergencyNumbers.ts
// for the verified source of each number.
export default function EmergencyNumbersBanner({
  country,
  className = '',
}: {
  country?: IdCountry;
  className?: string;
}) {
  const { numbers, note } = getEmergencyNumbers(country);

  return (
    <div className={`rounded-3xl bg-rosa-700 text-white p-5 sm:p-6 break-inside-avoid ${className}`}>
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/80">
        <Siren className="w-3.5 h-3.5" /> Emergency — call now
      </p>
      <div className={`mt-3 grid gap-2.5 ${numbers.length > 1 ? 'sm:grid-cols-2' : ''}`}>
        {numbers.map((n) => (
          <a
            key={n.number}
            href={`tel:${n.number}`}
            className="flex items-center justify-between gap-3 rounded-2xl bg-white/15 hover:bg-white/25 transition-colors px-4 py-3"
          >
            <span className="text-[13px] font-semibold text-white/90 leading-snug">{n.label}</span>
            <span className="inline-flex items-center gap-1.5 shrink-0 text-2xl sm:text-3xl font-black tabular-nums">
              <Phone className="w-5 h-5 sm:w-6 sm:h-6" /> {n.number}
            </span>
          </a>
        ))}
      </div>
      {note && <p className="mt-2.5 text-[12px] text-white/70">{note}</p>}
    </div>
  );
}
