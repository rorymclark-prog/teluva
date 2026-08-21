/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { LangProvider } from './i18n/LangContext';
import { FamilyProvider, useFamilyCtx } from './contexts/FamilyContext';
import { ChatDraftProvider } from './contexts/ChatDraftContext';
import Dashboard from './components/Dashboard';
import FamilyOnboarding from './components/FamilyOnboarding';
import AccountLoadError from './components/AccountLoadError';
import FamilySettings from './components/FamilySettings';
import UpdateBanner from './components/UpdateBanner';
import GlobalCopyScan from './components/GlobalCopyScan';
import { AppearanceProvider } from './contexts/AppearanceContext';

// ---------------------------------------------------------------------------
// AppInner — reads FamilyContext and gates which screen to show
// ---------------------------------------------------------------------------

function AppInner() {
  const { loading, uid, familyId, isAdmin, loadError } = useFamilyCtx();
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  // FamilySettings is a SIBLING of Dashboard, and it writes the shared
  // HubSettings doc directly rather than through Dashboard's own save path.
  // Dashboard loads that doc ONCE, in an effect keyed on the signed-in user and
  // the active space — neither of which changes when a switch is flipped in
  // here. So every preference on that screen that the Dashboard tree renders
  // from (the Calendar panels section in particular) was written correctly and
  // then stayed invisible until the app was fully reloaded — which on an
  // installed PWA can be days. This counter is the nudge: FamilySettings bumps
  // it after a successful write, Dashboard re-reads on it.
  const [settingsVersion, setSettingsVersion] = React.useState(0);

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

  // 3. Signed in, but the family lookup ITSELF failed — we don't actually
  // know if this account has a vault or not. Must come before the
  // familyId===null check below: that check can't tell "confirmed new
  // user" apart from "couldn't check," and FamilyOnboarding's create-family
  // flow can write a brand-new family doc, which would silently orphan an
  // existing member's real vault if they submitted it here by mistake.
  if (loadError) {
    return <AccountLoadError message={loadError} />;
  }

  // 4. Signed in, lookup succeeded, confirmed not yet in a family — onboarding
  if (familyId === null) {
    return <FamilyOnboarding />;
  }

  // 5. Fully loaded — render main app
  // A row in the header's account menu (see Dashboard's accountMenuItems), not
  // the unlabelled gear icon it used to be — nobody could tell it apart from
  // the hub-settings gear sitting next to it.
  const familySettingsButton = isAdmin ? (
    <button
      type="button"
      onClick={() => setIsSettingsOpen(true)}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-semibold text-ink-700 hover:bg-cream-100 transition-colors cursor-pointer"
    >
      {/* Users-cog via Lucide — inline to avoid pulling the icon set into App. */}
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
      <span className="flex-1 text-left">Members &amp; roles</span>
    </button>
  ) : null;

  return (
    <>
      <Dashboard familySettingsButton={familySettingsButton} settingsVersion={settingsVersion} />
      {isAdmin && isSettingsOpen && (
        <FamilySettings
          onClose={() => setIsSettingsOpen(false)}
          onSettingsChanged={() => setSettingsVersion((v) => v + 1)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Root — wraps everything in FamilyProvider
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <AppearanceProvider>
      <LangProvider>
        <FamilyProvider>
          <ChatDraftProvider>
            <AppInner />
            <GlobalCopyScan />
          </ChatDraftProvider>
        </FamilyProvider>
        <UpdateBanner />
      </LangProvider>
    </AppearanceProvider>
  );
}
