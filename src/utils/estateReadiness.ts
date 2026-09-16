import type { EstateRecord, DesignatedSuccessor, EmergencyInstructions } from '../types';
import { isReviewStale, findabilityGap } from './willsEstate';

/**
 * HOW READY IS THIS, AND WHAT IS THE NEXT SMALL THING.
 *
 * Rory: "i want some basic instructions to come up when someone is doing
 * there will and maybe a seperate progress slider thats says how ready one
 * is".
 *
 * Deliberately ONE component rather than two. A page of instructions at the
 * top is read once and then scrolled past forever; a bare percentage tells
 * you that you are at 40% and nothing about what the other 60% is. So the
 * instruction IS the step: each incomplete item carries the one sentence
 * that explains it, and the bar is just how many are done.
 *
 * THE LINE THIS FILE DOES NOT CROSS. Every `how` below tells somebody what
 * to type into THIS APP. None of them says what their will should contain,
 * whether they need one, how it must be signed, or who should inherit — that
 * is legal advice and Teluva does not give it (see DocumentAskModal for the
 * same boundary and the reason). "Record where the original is kept" is an
 * instruction about a text field. "Get your will witnessed" would not be, and
 * is not here.
 *
 * The one place this states a fact about the law rather than the app is the
 * incapacity step, and it states only the distinction itself — that a will
 * takes effect after death, so it does not cover somebody who is alive and
 * cannot decide. Which document answers that, and whether they want one, is
 * theirs and their lawyer's.
 */

export interface EstateStep {
  id: string;
  label: string;
  /** The one sentence shown when it is not done. An app instruction, never advice. */
  how: string;
  done: boolean;
  /** Weight — not every step is worth the same. */
  weight: number;
}

export interface EstateReadiness {
  steps: EstateStep[];
  doneCount: number;
  percent: number;      // 0–100, weighted
  /** The next thing worth doing — highest weight among the undone. */
  next: EstateStep | null;
}

const has = (v?: string) => typeof v === 'string' && v.trim().length > 0;
const isKind = (r: EstateRecord, re: RegExp) => re.test(r.kind || '');

export function computeEstateReadiness(input: {
  records?: EstateRecord[];
  successor?: DesignatedSuccessor;
  instructions?: EmergencyInstructions;
  /** From firstHours — whether any funeral policy or burial society is recorded. */
  hasFuneralCover?: boolean;
}): EstateReadiness {
  const records = input.records || [];
  const wills = records.filter((r) => isKind(r, /will|codicil|testament/i));
  const will = wills[0];

  const steps: EstateStep[] = [
    {
      id: 'will-exists',
      label: 'A will is recorded here',
      how: 'Add a record for it, even if it is not written yet — an empty row with the right name is what the rest of this list hangs off.',
      done: wills.length > 0,
      weight: 3,
    },
    {
      id: 'will-status',
      label: 'It says what state the will is in',
      how: 'Set “What state is it in” — an unsigned draft and a signed original are very different things to leave behind.',
      done: !!will && !!will.status && will.status !== 'unknown',
      weight: 2,
    },
    {
      id: 'will-findable',
      label: 'Someone could actually find the signed original',
      how: 'Record where the original is kept, or who holds it, or that it is in a will register. Any one of the three is enough.',
      done: !!will && findabilityGap(will) === null,
      weight: 3,
    },
    {
      id: 'executor',
      label: 'The executor is written down',
      how: 'Put the name in “Executor” on the will record, so nobody has to work out who it is from the document itself.',
      done: !!will && has(will.executor),
      weight: 2,
    },
    {
      id: 'incapacity',
      label: 'Something covers being alive but unable to decide',
      /* The one legal FACT in this file, and it is only a distinction. */
      how: 'A will takes effect after death, so it does not cover someone who is alive and cannot decide. If a power of attorney or healthcare directive exists, record it here.',
      done: records.some((r) => isKind(r, /power of attorney|directive|vorsorge|patientenverf/i)),
      weight: 2,
    },
    {
      id: 'funeral',
      label: 'The first phone call is written down',
      how: 'Add the funeral cover or burial society under Finances \u2192 Insurance, with its claims number. It appears on this page once it is there. It is the thing needed in the first day, long before anyone reads a will.',
      done: !!input.hasFuneralCover,
      weight: 3,
    },
    {
      id: 'successor',
      label: 'Somebody is named to step in',
      how: 'Name them under “Who takes over”, and choose how much they are told now rather than leaving them to find out later.',
      done: has(input.successor?.name),
      weight: 2,
    },
    {
      id: 'practical',
      label: 'The practical things are noted',
      how: 'Who needs telling, what needs closing, where the keys and safes are — the jobs that belong to no single document.',
      done: !!input.instructions && (
        (input.instructions.notifyContacts?.length || 0) > 0
        || (input.instructions.accountsToClose?.length || 0) > 0
        || has(input.instructions.keysAndSafes)
      ),
      weight: 1,
    },
    {
      id: 'reviewed',
      label: 'It has been looked at recently',
      how: 'Set “Last reviewed” when you next check it. Marriages, births and moves are the usual reasons a will stops matching the family.',
      done: !!will && has(will.lastReviewed) && !isReviewStale(will.lastReviewed),
      weight: 1,
    },
  ];

  const total = steps.reduce((n, s) => n + s.weight, 0);
  const earned = steps.reduce((n, s) => n + (s.done ? s.weight : 0), 0);
  const undone = steps.filter((s) => !s.done);
  // Highest weight first; ties keep list order, which runs roughly in the
  // order somebody would actually do them.
  const next = undone.length
    ? undone.reduce((best, s) => (s.weight > best.weight ? s : best), undone[0])
    : null;

  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    percent: total === 0 ? 0 : Math.round((earned / total) * 100),
    next,
  };
}
