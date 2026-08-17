import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { auth, logout } from '../lib/firebase';

/**
 * Shown when a person is signed in but the app could NOT determine whether
 * they belong to a family — the users/{uid} lookup itself threw (network
 * blip, cold start, a Firestore quota error, etc.), as opposed to succeeding
 * and confirming there's no family yet.
 *
 * This must never be replaced with <FamilyOnboarding /> for this case: that
 * screen's "Create family" button writes a brand-new family doc, which for
 * an existing member would silently orphan their real vault the moment they
 * submit it — while reading exactly like a normal first-time setup screen.
 * See FamilyCtxValue.loadError in FamilyContext.tsx for the full reasoning.
 */
export default function AccountLoadError({ message }: { message: string | null }) {
  const email = auth.currentUser?.email ?? '';

  return (
    <div className="min-h-screen bg-cream-50 flex items-center justify-center p-4">
      <div className="card max-w-md w-full p-5 sm:p-8 space-y-6 text-center">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-honey-50 text-honey-700 flex items-center justify-center">
          <AlertTriangle className="w-6 h-6" />
        </div>

        <div className="space-y-1.5">
          <h1 className="font-display text-2xl text-ink-900">Couldn't load your account</h1>
          <p className="text-ink-500 text-sm leading-relaxed">
            {email ? <>Signed in as <span className="text-ink-700">{email}</span>, but </> : 'Signed in, but '}
            we couldn't check your family vault just now. This is usually a
            brief connection hiccup — it's <strong>not</strong> a sign your data
            is missing.
          </p>
          {message && (
            <p className="text-[11px] text-ink-300 font-mono break-words pt-1">{message}</p>
          )}
        </div>

        <button
          onClick={() => window.location.reload()}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          <RefreshCw size={16} />
          Try again
        </button>

        <button
          onClick={logout}
          className="block w-full text-center text-xs text-ink-400 underline underline-offset-2 hover:text-ink-600"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
