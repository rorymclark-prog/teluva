import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, ChevronRight, ChevronDown } from 'lucide-react';
import { FamilyMember, HouseholdInfo, InsurancePolicy, EstateRecord } from '../types';
import { loadHousehold, loadFinances, loadWillsEstate, loadFamilyRoles } from '../utils/db';
import { computeReadiness, ReadinessGap, ReadinessSeverity } from '../utils/readiness';
import { useWillsAccess } from '../hooks/useWillsAccess';

// The "Emergency Readiness" card — see utils/readiness.ts for the full
// reasoning and the CRITICAL design decision behind it: this is NOT a survey.
// Every number here is computed from data already in the vault; every gap is
// a one-tap link to the screen that fills it. This component's only job is
// to load that data and render what the pure scorer returns — no scoring
// logic lives here.
//
// Tone matters as much as the numbers: matter-of-fact, never alarmist. A
// family scoring 40% sees a checklist, not a verdict — see the copy below
// (no "you failed", no red/danger framing on the score itself).

const SEVERITY_DOT: Record<ReadinessSeverity, string> = {
  critical: 'bg-rosa-500',
  important: 'bg-honey-500',
  minor: 'bg-ink-300',
};

// Deliberately calm at every tier — a low score should read as "here's the
// list", not "alarm". The colour only shifts warmer as the family clears
// items, which is the reward, not a scold at the low end.
function scoreTone(score: number): { text: string; bar: string } {
  if (score >= 80) return { text: 'text-sage-600', bar: 'bg-sage-500' };
  if (score >= 50) return { text: 'text-honey-700', bar: 'bg-honey-500' };
  return { text: 'text-clay-600', bar: 'bg-clay-500' };
}

const TOP_SHOWN = 4;

export default function ReadinessCard(
  { members, familyId, demo, onGo, onGoView }:
  {
    members: FamilyMember[];
    familyId: string | null;
    demo: boolean;
    onGo: (memberId: string, tab: string) => void;
    onGoView: (view: string) => void;
  },
) {
  // Wills & Estate is no longer readable by every member (v230), so the will
  // check is only scored for people who can actually open it. `demo` keeps
  // the sample card unchanged — there is no real document behind it.
  const { mayRead } = useWillsAccess();
  const mayReadWills = demo || mayRead;
  const [household, setHousehold] = useState<HouseholdInfo | null>(null);
  const [insurancePolicies, setInsurancePolicies] = useState<InsurancePolicy[]>([]);
  const [estateRecords, setEstateRecords] = useState<EstateRecord[]>([]);
  // Defaults to 1 (a single admin) rather than 0 — that's the true starting
  // state for every real space (whoever created it is its first admin,
  // enforced server-side), and it's the honest "not yet loaded" guess too:
  // better to briefly show the second-admin gap and have it clear once the
  // roles collection resolves than to briefly hide a real gap.
  const [adminCount, setAdminCount] = useState(1);

  useEffect(() => {
    let cancelled = false;
    loadHousehold().then((h) => { if (!cancelled) setHousehold(h); }).catch(() => { if (!cancelled) setHousehold(null); });
    loadFinances().then((f) => { if (!cancelled) setInsurancePolicies(f?.insurance || []); }).catch(() => { if (!cancelled) setInsurancePolicies([]); });
    // Only if this person may open Wills & Estate. Without the guard the read
    // is refused by the rule and the score silently reports "no will on file"
    // to someone who simply isn't allowed to know either way.
    if (mayReadWills) {
      loadWillsEstate().then((d) => { if (!cancelled) setEstateRecords(d?.records || []); }).catch(() => { if (!cancelled) setEstateRecords([]); });
    } else {
      setEstateRecords([]);
    }
    if (familyId) {
      loadFamilyRoles(familyId)
        .then((roles) => {
          if (cancelled) return;
          const admins = Object.values(roles).filter((r) => r.role === 'admin').length;
          // A resolved-but-empty roles read is far more likely a permissions/
          // timing hiccup than a genuinely admin-less family (impossible per
          // firestore.rules), so it isn't trusted as a real zero.
          if (admins > 0) setAdminCount(admins);
        })
        .catch(() => { /* keep the safe default of 1 */ });
    }
    return () => { cancelled = true; };
  }, [familyId, mayReadWills]);

  const result = useMemo(
    () => computeReadiness({ members, estateRecords, insurancePolicies, household, adminCount, estateVisible: mayReadWills }),
    [members, estateRecords, insurancePolicies, household, adminCount, mayReadWills],
  );

  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? result.gaps : result.gaps.slice(0, TOP_SHOWN);
  const extra = result.gaps.length - TOP_SHOWN;
  const tone = scoreTone(result.score);

  const goTo = (gap: ReadinessGap) => {
    if (gap.view) onGoView(gap.view);
    else if (gap.memberId && gap.tab) onGo(gap.memberId, gap.tab);
  };

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 flex items-center gap-3 border-b border-cream-200">
        <div className="p-2 rounded-xl bg-clay-50 text-clay-600 shrink-0">
          <ShieldCheck className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <h3 className="font-display text-[15px] font-bold text-ink-900">Emergency readiness</h3>
          <p className="text-[11.5px] text-ink-400 font-medium">
            {demo ? 'A sample of what this looks like' : "How ready things are, if something happens to you"}
          </p>
        </div>
        <span className={`ml-auto text-xl font-bold tabular-nums ${tone.text}`}>{result.score}%</span>
      </div>

      <div className="px-5 pt-3.5">
        <div className="h-2 rounded-full bg-cream-200 overflow-hidden" role="progressbar" aria-valuenow={result.score} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full transition-all ${tone.bar}`} style={{ width: `${result.score}%` }} />
        </div>
      </div>

      {result.gaps.length === 0 ? (
        <div className="px-5 py-4 text-[13px] text-ink-600">
          Everything this card checks for is on file. Nice work.
        </div>
      ) : (
        <>
          <div className="divide-y divide-cream-100 mt-1">
            {shown.map((gap) => {
              const clickable = !!(gap.view || (gap.memberId && gap.tab));
              const Row = clickable ? 'button' : 'div';
              return (
                <Row
                  key={gap.id}
                  {...(clickable ? { type: 'button', onClick: () => goTo(gap) } : {})}
                  className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${clickable ? 'hover:bg-cream-50 cursor-pointer group' : ''}`}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${SEVERITY_DOT[gap.severity]}`} />
                  <span className="flex-1 text-[13.5px] text-ink-800 font-medium">{gap.label}</span>
                  {clickable && <ChevronRight className="w-4 h-4 text-ink-300 group-hover:text-ink-500 shrink-0" />}
                </Row>
              );
            })}
          </div>
          {extra > 0 && (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="w-full px-5 py-2.5 text-[12.5px] font-semibold text-clay-600 hover:bg-cream-50 transition-colors text-center cursor-pointer flex items-center justify-center gap-1"
            >
              {showAll ? 'Show less' : `Show all ${result.gaps.length}`}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAll ? 'rotate-180' : ''}`} />
            </button>
          )}
        </>
      )}
    </div>
  );
}
