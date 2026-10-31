import type { FamilyActionsDoc } from '../types';
import { actionDateISO } from './actions';

/** Demo worklists use people from the matching fixture, never real records. */
export function demoActions(business = false, now = new Date()): FamilyActionsDoc {
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 4);
  const shared = { dueDate: actionDateISO(due), status: 'open' as const, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  return { items: [business ? {
    ...shared,
    id: 'demo-action-roster', title: 'Confirm next month’s team roster',
    notes: 'Check availability with the team before the planning meeting.',
    ownerMemberId: 'demo-biz-manager',
  } : {
    ...shared,
    id: 'demo-action-school', title: 'Send the school form',
    notes: 'Check the details together, then return the signed form.',
    ownerMemberId: 'demo-papa',
    source: { key: 'demo-school-form', label: 'School details', memberId: 'demo-mia', tab: 'education' },
  }] };
}
