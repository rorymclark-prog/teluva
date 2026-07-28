import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';

/**
 * Short, calm "who can see this" line for screens that collect sensitive
 * data (IDs, passwords, bank details) — placed near the input itself so
 * someone typing a passport number or IBAN sees it at the moment it matters,
 * not buried once in a settings screen they may never open. Tone matches
 * AiConsentModal's transparency copy; the claim itself is deliberately narrow
 * and only repeats what LegalModal already states (family-isolated storage,
 * sign-in required) — nothing here is asserted that isn't verified in code.
 */
interface PrivacyNoteProps {
  children: ReactNode;
  /** Opens the full privacy policy (Dashboard's LegalModal). Omit if the caller has no way to open it — the note still reads fine without the link. */
  onOpenPrivacy?: () => void;
  className?: string;
}

export default function PrivacyNote({ children, onOpenPrivacy, className = '' }: PrivacyNoteProps) {
  return (
    <p className={`flex items-start gap-1.5 text-[12px] text-ink-400 leading-relaxed ${className}`}>
      <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        {children}
        {onOpenPrivacy && (
          <>
            {' '}
            <button
              type="button"
              onClick={onOpenPrivacy}
              className="underline underline-offset-2 hover:text-ink-600 cursor-pointer"
            >
              Privacy policy
            </button>
          </>
        )}
      </span>
    </p>
  );
}
