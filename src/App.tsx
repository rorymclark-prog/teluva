/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { LangProvider } from './i18n/LangContext';
import { FamilyProvider, useFamilyCtx } from './contexts/FamilyContext';
import Dashboard from './components/Dashboard';
import FamilyOnboarding from './components/FamilyOnboarding';
import FamilySettings from './components/FamilySettings';
import UpdateBanner from './components/UpdateBanner';

// ---------------------------------------------------------------------------
// AppInner — reads FamilyContext and gates which screen to show
// ---------------------------------------------------------------------------

function AppInner() {
  const { loading, uid, familyId, isAdmin } = useFamilyCtx();
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);

  // 1. Auth/family resolution still in flight
  if (loading) {
    return (
      <div className="min-h-screen bg-cream-100 flex items-center justify-center font-sans">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clay-500" />
      </div>
    );
  }

  // 2. Not signed in — Dashboard handles its own sign-in screen
  if (!uid) {
    return <Dashboard familySettingsButton={null} />;
  }

  // 3. Signed in but not yet in a family — show onboarding
  if (familyId === null) {
    return <FamilyOnboarding />;
  }

  // 4. Fully loaded — render main app
  const familySettingsButton = isAdmin ? (
    <button
      type="button"
      onClick={() => setIsSettingsOpen(true)}
      className="btn-quiet px-3 py-2"
      title="Family settings (admin)"
      aria-label="Family settings"
    >
      {/* Settings/gear via Lucide — imported inside Dashboard already, so inline SVG here to avoid re-import */}
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    </button>
  ) : null;

  return (
    <>
      <Dashboard familySettingsButton={familySettingsButton} />
      {isAdmin && isSettingsOpen && (
        <FamilySettings onClose={() => setIsSettingsOpen(false)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Root — wraps everything in FamilyProvider
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <LangProvider>
      <FamilyProvider>
        <AppInner />
      </FamilyProvider>
      <UpdateBanner />
    </LangProvider>
  );
}
