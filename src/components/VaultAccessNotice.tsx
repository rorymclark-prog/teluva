import React from 'react';
import { LockKeyhole, RefreshCw } from 'lucide-react';
import { logout } from '../lib/firebase';
import type { VaultAccessIssue } from '../utils/vaultAccess';

export default function VaultAccessNotice({ issue }: { issue: VaultAccessIssue }) {
  const needsAdmin = issue.reason === 'admin-refresh';
  const [signOutError, setSignOutError] = React.useState('');
  return (
    <div className="min-h-screen bg-cream-50 flex items-center justify-center p-4" role="alert">
      <div className="card max-w-md w-full p-6 sm:p-8 space-y-5 text-center">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-honey-50 text-honey-700 flex items-center justify-center"><LockKeyhole className="w-6 h-6" /></div>
        <div className="space-y-2">
          <h1 className="font-display text-2xl text-ink-900">{needsAdmin ? 'Shared records need an admin refresh' : 'Protected records could not be opened'}</h1>
          <p className="text-sm text-ink-600 leading-relaxed">
            {needsAdmin
              ? 'An admin needs to open this space’s family profiles, Household and Finances once to prepare older shared records for the stronger vault protection. Then try again.'
              : 'Check your connection and try again. Your saved records have been kept; Teluva has paused the vault so unreadable values cannot replace them.'}
          </p>
        </div>
        <button type="button" onClick={() => window.location.reload()} className="btn-primary w-full flex items-center justify-center gap-2"><RefreshCw size={16} />Try again</button>
        <a href="/emergency-pack" className="block text-sm text-clay-700 underline underline-offset-2">Open saved emergency pack</a>
        <button type="button" onClick={() => void logout().catch(error => setSignOutError(error instanceof Error ? error.message : 'Could not sign out. Check your connection and try again.'))} className="block w-full text-xs text-ink-500 underline underline-offset-2">Sign out</button>
        {signOutError && <p role="status" className="text-xs text-rosa-700">{signOutError}</p>}
      </div>
    </div>
  );
}
