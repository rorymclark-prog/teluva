import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { FamilyMember, ClothingSizes, FamilyDocument, CalendarEvent, AssetItem, ContactEntry, ExtendedBirthday, VaultDocument, ReferralRecord, HealthcareProvider, MemberRole, TripDocRole } from '../types';
import { withContactBirthdays } from '../utils/extendedBirthdaySources';
import { hubDisplayName } from '../utils/hubName';
import ConnectedFamilies from './ConnectedFamilies';
import ConnectedInline from './ConnectedInline';
import SharedHousehold from './SharedHousehold';
import SharedProfile from './SharedProfile';
import type { SharedMember, NamedByThem, FamilyLink } from '../utils/familyLink';
import { useT } from '../i18n/LangContext';
import { Strings } from '../i18n/locales';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { useWillsAccess } from '../hooks/useWillsAccess';
import {
  loadFamilyMembers, saveFamilyMembers,
  loadCalendarEvents, saveCalendarEvents,
  loadFamilyInfo, saveFamilyInfo,
  loadHousehold, saveHousehold,
  loadFinances, saveFinances,
  loadTimeline, saveTimeline,
  loadSettings, saveSettings,
  loadDocuments, saveDocuments,
  loadShopping, saveShopping,
  loadRecipes, saveRecipes,
  saveAsset, loadAssets, deleteAsset,
  loadFamilyWords, saveFamilyWords,
  loadWillsEstate, saveWillsEstate,
  loadSlips, saveSlips,
  loadAnniversaries, saveAnniversaries,
  loadExtendedBirthdays, saveExtendedBirthdays,
  loadInMemory,
  leaveFamily,
  deleteDocumentEverywhere,
  loadFamilyRoles,
} from '../utils/db';
import { downloadZip } from '../utils/share';
import { appConfirm } from '../utils/appConfirm';
import {
  applyMemberEdits, applyInfoEdits, hasMemberEdits, hasInfoEdits,
  applyCalendarEdits, applyHouseholdEdits, applyFinancesEdits, applyTimelineEdits,
  hasCalendarEdits, hasHouseholdEdits, hasFinancesEdits, hasTimelineEdits,
  hasShoppingEdits, applyShoppingEdits, hasAssetEdits,
  hasFamilyWordsEdits, applyFamilyWordsEdits,
  hasRecipeEdits, applyRecipeEdits,
  hasAnniversaryEdits, applyAnniversaryEdits,
  hasExtendedBirthdayEdits, applyExtendedBirthdayEdits,
  hasEstateEdits, applyEstateEdits,
  hasSuccessorEdits, applySuccessorEdit, hasInstructionsEdits, applyInstructionsEdit,
  hasStatusEdits, applyStatusEdit,
  hasSlipEdits, applySlipEdits,
  hasServiceRecordEdits, applyServiceRecordEdits,
  hasHomeServiceEdits, applyHomeServiceEdits,
  hasPetHealthEdits, applyPetHealthEdits,
  hasTripAttachEdits, applyTripAttachEdits,
} from '../utils/aiApply';
// EDIT/DELETE existing records (confirm-before-destroy) — real logic lives here.
import { hasDestructiveEdits, applyDestructiveEdits } from '../utils/aiDestructive';
import { AiEdit } from './AIChatbot';
import type { PackRequest } from '../utils/exportPack';
import {
  UndoRecord, UndoDomain,
  diffMemberUndo, diffInfoUndo, diffHouseholdUndo, diffFinancesUndo, mapNewIds,
  removeUndoneInfoRecords,
} from '../utils/aiUndo';
import AssistantBubble from './AssistantBubble';
import AiConsentModal from './AiConsentModal';
import AvatarRestyleModal from './AvatarRestyleModal';
import SectionMenu from './SectionMenu';
import LegalModal, { LegalTab } from './LegalModal';
import { compressImageToAvatar } from '../utils/imageCompress';
import HubSettingsModal from './HubSettingsModal';
import FamilyStatus from './FamilyStatus';
import ImageLightbox from './ImageLightbox';
import { HubSettings, HiddenDatePerson, HiddenDatePersonFor } from '../types';
import { auth, loginWithGoogle, logout } from '../lib/firebase';
// getAccessToken reads the SAME module-level Google OAuth token cache that
// FamilyCalendar.tsx's connect/import/export UI already populates via
// googleSignIn() (see utils/firebase.ts) — importing it here does not
// duplicate any sign-in or token-refresh logic, it just lets the outbound
// auto-sync effect below (which needs to run regardless of which tab is on
// screen — see that effect's comment for why) read the same cached token
// FamilyCalendar uses. invalidateAccessToken clears that shared cache on a
// 401 so neither component keeps retrying a token already known to be dead.
import { getAccessToken, invalidateAccessToken, connectGoogleAccess, isGoogleDisconnected } from '../utils/firebase';
import {
  importGoogleEvents, readLastGoogleImport, writeLastGoogleImport, shouldImportOnStartup,
  hasGoogleImportedEvents, staleSyncNote, GoogleImportAuthError, isGoogleImportStale,
} from '../utils/googleCalendarImport';
import { tagEventToMember } from '../utils/untaggedAppointments';
import { pushEventToGoogleCalendar, isEligibleForAutoSync, GoogleCalendarAuthError } from '../utils/googleCalendarSync';
import { onAuthStateChanged } from 'firebase/auth';
import {
  DEMO_MEMBERS, DEMO_EVENTS, DEMO_CONTACTS, DEMO_EXTENDED_BIRTHDAYS, isDemoMode,
  DEMO_BUSINESS_MEMBERS, DEMO_BUSINESS_EVENTS, DEMO_BUSINESS_CONTACTS,
  DEMO_BUSINESS_NAME, demoSpaceType, demoIsOwner, DEMO_ACCOUNT_ROLES, DEMO_ACCOUNT_UID,
} from '../utils/demoData';
import { warmAvatarColor, AVATAR_COLORS } from '../utils/avatarPalette';
import { HiddenPeopleProvider, HideDatesButton, memberDates } from '../contexts/HiddenPeopleContext';
import { hiddenKey, type SettingsHiddenLists } from '../utils/hiddenPeople';
import AddMemberModal from './AddMemberModal';
import EditMemberModal from './EditMemberModal';
import MemberSizing from './MemberSizing';
import MemberDocuments from './MemberDocuments';
import DocumentViewer from './DocumentViewer';
import GrowthTracker from './GrowthTracker';
import BirthdayTimelapse from './BirthdayTimelapse';
import SecureSecrets from './SecureSecrets';
import MemberFavorites from './MemberFavorites';
import MemberMedical from './MemberMedical';
import MemberGuardians from './MemberGuardians';
import MemberOverview from './MemberOverview';
import NeedsAttention from './NeedsAttention';
import ReadinessCard from './ReadinessCard';
import ImportantComingUp from './ImportantComingUp';
import { importantComingUp } from '../utils/importantEvents';
import { todayIsoLocal } from '../utils/memberAppointments';
import MemberIDs from './MemberIDs';
import MemberTravel from './MemberTravel';
import CareSchedule from './CareSchedule';
import MemberPreferences from './MemberPreferences';
import MemberEmployeePreferences from './MemberEmployeePreferences';
import MemberSayings from './MemberSayings';
import MemberFavoriteQuotes from './MemberFavoriteQuotes';
import SpaceSwitcher from './SpaceSwitcher';
import { switchSpace, createSpace, joinFamily, renameSpace, readCachedFamilyMembers, loadChatHistory, NewBusinessExtra } from '../utils/db';
import OnThisDay from './OnThisDay';
import FamilyWordOfDay from './FamilyWordOfDay';
import FlashbackCard from './FlashbackCard';
import EmergencyCard from './EmergencyCard';
import BabysitterMode from './BabysitterMode';
import TravelPack from './TravelPack';
import TripPack from './TripPack';
import { buildTrips, currentTrips, keyFactsCurrent, moveTripDoc } from '../utils/trip';
import { extractKeyFacts, saveKeyFacts, vaultDocToReaderTarget } from '../utils/docKeyFacts';
import { uploadTripDocFile } from '../utils/tripDocUpload';
import { resolveMe } from '../utils/me';
import TeamDirectory from './TeamDirectory';
import RecentActivity from './RecentActivity';
import FamilyStats from './FamilyStats';
import FamilyQuiz from './FamilyQuiz';
import HealthTimeline from './HealthTimeline';
import MemberCalendarDates from './MemberCalendarDates';
import { sunSign, isSameLocalDay, blurbCacheKey } from '../utils/astrology';
import { computeBirthChart } from '../utils/birthChart';
import MemberCV from './MemberCV';
import MemberEducation from './MemberEducation';
import MemberAddresses from './MemberAddresses';
import { GraduationCap } from 'lucide-react';
import CelebrationOverlay from './CelebrationOverlay';
import InstallPrompt from './InstallPrompt';
import FirstRunTour from './FirstRunTour';
import FamilyInterview from './FamilyInterview';
import AppearanceControls from './AppearanceControls';
import FeedbackModal from './FeedbackModal';
import EmberNavigation, { EmberDestination } from './EmberNavigation';
import FamilyPulse, { PulseExpiryWarning } from './FamilyPulse';
import CaptureMenu from './CaptureMenu';
import EmberViewHeader from './EmberViewHeader';
import { useAppearance } from '../contexts/AppearanceContext';
import {
  Users, UserPlus, FileText, Search, Bell, User, ShieldCheck,
  Scissors, Trash2, Key, TrendingUp, Calendar, Heart,
  LogOut, LogIn, Download, Upload, Cloud, CloudOff, MessageCircle, IdCard,
  HeartPulse, Plane, Sparkles, Siren, Home, Landmark, CalendarHeart, FolderArchive, GripVertical, ShoppingCart,
  Package, KeyRound, MapPin, Phone, Mail, LayoutDashboard, Stethoscope, BarChart3, HelpCircle, Baby,
  Quote, BookHeart, Car, ChefHat, Globe2, Clapperboard, Flower2, Briefcase, ScrollText, Receipt, PawPrint, Network,
  Loader2, UserMinus, ChevronDown, Settings, CalendarClock, Wand2, Gift, UserRoundCheck, HeartHandshake, Cake, MessageSquare, Link2, Camera, Lock} from 'lucide-react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'motion/react';

// Lazy-loaded main-view screens — audit finding, 2026-07-30. Exactly one of
// these is ever visible at once (each renders behind a single `mainView ===
// 'x'` gate below, mutually exclusive with all the others), but until now
// every one was imported eagerly at the top of this file, so a user who only
// ever opens Calendar still downloaded WillsEstateView, SlipsView, RecipeBook,
// InMemoryView, TravelTimelineView, DocumentVault, GoogleDriveSync,
// HouseholdView and FinancesView — 6,700+ lines across just those files —
// inside the SAME chunk as the code they actually needed. `npm run build`
// measured the result at 3.29MB minified (960KB gzip), well over Vite's
// warning threshold. React.lazy + the single <Suspense> around the mainView
// switch below gives each of these its own chunk, downloaded only the first
// time its tab is actually opened.
//
// Deliberately NOT applied to whatever renders behind `mainView === 'profiles'`
// — that is the very first thing every user sees, and lazy-loading it would
// trade a smaller initial download for a guaranteed extra network round trip
// on every single visit, the opposite of the point.
const FamilyCalendar = React.lazy(() => import('./FamilyCalendar'));
const ImportantInfo = React.lazy(() => import('./ImportantInfo'));
const EmergencyView = React.lazy(() => import('./EmergencyView'));
const HouseholdView = React.lazy(() => import('./HouseholdView'));
const FinancesView = React.lazy(() => import('./FinancesView'));
const InsuranceView = React.lazy(() => import('./InsuranceView'));
const FamilyWordsView = React.lazy(() => import('./FamilyWordsView'));
const VehiclesView = React.lazy(() => import('./VehiclesView'));
const PetsView = React.lazy(() => import('./PetsView'));
const FamilyTreeView = React.lazy(() => import('./FamilyTreeView'));
const TimelineView = React.lazy(() => import('./TimelineView'));
const TravelTimelineView = React.lazy(() => import('./TravelTimelineView'));
const DocumentVault = React.lazy(() => import('./DocumentVault'));
const ShoppingList = React.lazy(() => import('./ShoppingList'));
const FamilyChat = React.lazy(() => import('./FamilyChat'));
const GoogleDriveSync = React.lazy(() => import('./GoogleDriveSync'));
import { takeSharedFiles, shareOutcome, clearShareFlag } from '../utils/sharedInbox';
const Assets = React.lazy(() => import('./Assets'));
const RecipeBook = React.lazy(() => import('./RecipeBook'));
const InMemoryView = React.lazy(() => import('./InMemoryView'));
const WillsEstateView = React.lazy(() => import('./WillsEstateView'));
const SlipsView = React.lazy(() => import('./SlipsView'));
const AnniversariesView = React.lazy(() => import('./AnniversariesView'));
const ExtendedBirthdaysView = React.lazy(() => import('./ExtendedBirthdaysView'));
const FamilyPasswords = React.lazy(() => import('./FamilyPasswords'));
const GiftsOccasionsView = React.lazy(() => import('./GiftsOccasionsView'));
const ExportPackModal = React.lazy(() => import('./ExportPackModal'));

// Shown only while the ACTIVE tab's chunk is still downloading — on a repeat
// visit (already cached) or a fast connection this never appears at all.
// Matches the height/centering of the loading state already used elsewhere
// in this file (see the auth-loading spinner) so switching tabs doesn't
// visibly jolt the layout.
function ViewLoading() {
  return (
    <div className="flex justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clay-500"></div>
    </div>
  );
}

export function calculateAge(birthdate?: string): string | null {
  if (!birthdate) return null;
  const birthDate = new Date(birthdate);
  if (isNaN(birthDate.getTime())) return null;
  const today = new Date();

  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  if (age < 0) return null;
  if (age === 0) {
    const months = (today.getFullYear() - birthDate.getFullYear()) * 12 + today.getMonth() - birthDate.getMonth();
    if (months <= 0) return 'Newborn';
    return `${months}m`;
  }
  return `${age} yrs`;
}

// Detects a /join/{code} URL WITHOUT resolving or displaying the code or
// which family it belongs to — we're not signed in yet, so there's no safe
// way to look either of those up (no rate-limited, unauthenticated endpoint
// exists for it). This only softens the pre-auth pitch's copy; the actual
// join still happens post-sign-in in FamilyOnboarding's own codeFromUrl().
function isJoinLinkVisit(): boolean {
  return /^\/join\/.+/.test(window.location.pathname);
}

type TabId = 'education' | 'addresses' | 'overview' | 'sizes' | 'favorites' | 'growth' | 'timelapse' | 'medical' | 'care' | 'ids' | 'travel' | 'preferences' | 'documents' | 'secrets' | 'sayings' | 'cv' | 'guardians' | 'timeline';
type ViewId = 'pulse' | 'profiles' | 'assistant' | 'calendar' | 'info' | 'emergency' | 'household' | 'finances' | 'insurance' | 'timeline' | 'travelTimeline' | 'vault' | 'shopping' | 'chat' | 'drive' | 'assets' | 'passwords' | 'familyWords' | 'vehicles' | 'recipes' | 'inMemory' | 'willsEstate' | 'slips' | 'gifts' | 'anniversaries' | 'extendedBirthdays' | 'pets' | 'familyTree';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'medical', label: 'Medical', icon: HeartPulse },
  { id: 'care', label: 'Check-ups', icon: CalendarClock },
  { id: 'ids', label: 'ID & Passports', icon: IdCard },
  { id: 'guardians', label: 'Guardians', icon: UserRoundCheck },
  { id: 'sizes', label: 'Sizes', icon: Scissors },
  { id: 'favorites', label: 'Wishlist', icon: Heart },
  { id: 'growth', label: 'Growth', icon: TrendingUp },
  { id: 'timelapse', label: 'Timelapse', icon: Clapperboard },
  { id: 'travel', label: 'Travel', icon: Plane },
  { id: 'preferences', label: 'Likes', icon: Sparkles },
  { id: 'sayings', label: 'Sayings', icon: Quote },
  { id: 'timeline', label: 'Timeline', icon: CalendarHeart },
  { id: 'education', label: 'Education', icon: GraduationCap },
  { id: 'addresses', label: 'Addresses', icon: Home },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'secrets', label: 'Secrets', icon: Key },
  { id: 'cv', label: 'Work', icon: Briefcase },
];

type ProfileLens = 'essentials' | 'health' | 'life' | 'story';
const PROFILE_LENSES: { id: ProfileLens; label: string; note: string; tabs: TabId[] }[] = [
  { id: 'essentials', label: 'Essentials', note: 'Identity, access and records', tabs: ['overview', 'ids', 'addresses', 'guardians', 'documents', 'secrets'] },
  { id: 'health', label: 'Health', note: 'Care, check-ups and growth', tabs: ['medical', 'care', 'growth', 'timelapse'] },
  { id: 'life', label: 'Life', note: 'Daily needs, travel and wishes', tabs: ['education', 'sizes', 'favorites', 'travel', 'preferences', 'cv'] },
  { id: 'story', label: 'Story', note: 'Words and moments worth keeping', tabs: ['timeline', 'sayings'] },
];

function profileLensFor(tab: TabId): ProfileLens {
  return PROFILE_LENSES.find((lens) => lens.tabs.includes(tab))?.id || 'essentials';
}

// Kid/family-specific tabs that make no sense for an employee in a business space.
// 'guardians' joins this list for the same reason: a non-resident PARENT is a
// family-custody concept with no equivalent for an employee's HR record.
// 'timeline' too: a person's life timeline carries their health history,
// which has no place in an employee's record (lifeTimeline.ts rule 4).
const HIDDEN_IN_BUSINESS: TabId[] = ['education', 'addresses', 'care', 'sizes', 'favorites', 'growth', 'sayings', 'timelapse', 'guardians', 'timeline'];
// Work/CV belongs in personal as well as business profiles.
const HIDDEN_IN_FAMILY: TabId[] = [];
// Same idea, one level up — top-level nav sections that are family-only (the
// keepsake dictionary, the family memory timeline, a personal shopping list —
// no small-business equivalent researched). Insurance/Vehicles/Household/
// Assets/Documents/Passwords/Chat/etc. all stay — genuinely useful for a
// business too (Household becomes "Locations", Info becomes "Compliance" —
// see viewLabel below).
// 'emergency' is a medical/allergy/blood-type card — no business equivalent
// exists yet (a real workplace-incident log would be a distinct feature, not
// a relabel of this one) so it's hidden rather than mislabeled.
// 'timeline' is NOT in this list: in a business space it becomes the Business
// timeline — milestones, moments and dated papers, never anyone's health.
const HIDDEN_VIEWS_IN_BUSINESS: ViewId[] = ['familyWords', 'shopping', 'emergency', 'recipes', 'travelTimeline', 'inMemory', 'willsEstate', 'gifts', 'anniversaries', 'extendedBirthdays', 'pets', 'familyTree'];

// A persisted astrology blurb older than this is treated as stale and quietly
// regenerated next time that member's Overview is viewed — keeps the card
// feeling alive without the user having to remember to re-shuffle it.
const STALE_ASTROLOGY_MS = 30 * 24 * 60 * 60 * 1000;

const VIEWS: { id: ViewId; icon: React.ElementType }[] = [
  { id: 'profiles', icon: Users },
  { id: 'emergency', icon: Siren },
  { id: 'calendar', icon: Calendar },
  { id: 'info', icon: IdCard },
  { id: 'household', icon: Home },
  { id: 'finances', icon: Landmark },
  { id: 'insurance', icon: ShieldCheck },
  { id: 'vehicles', icon: Car },
  { id: 'pets', icon: PawPrint },
  { id: 'timeline', icon: CalendarHeart },
  { id: 'travelTimeline', icon: Globe2 },
  { id: 'vault', icon: FolderArchive },
  { id: 'assets', icon: Package },
  { id: 'recipes', icon: ChefHat },
  { id: 'anniversaries', icon: HeartHandshake },
  { id: 'extendedBirthdays', icon: Cake },
  { id: 'willsEstate', icon: ScrollText },
  { id: 'slips', icon: Receipt },
  { id: 'shopping', icon: ShoppingCart },
  { id: 'gifts', icon: Gift },
  { id: 'passwords', icon: KeyRound },
  { id: 'familyWords', icon: BookHeart },
  { id: 'chat', icon: MessageCircle },
  { id: 'drive', icon: Cloud },
  { id: 'inMemory', icon: Flower2 },
  { id: 'familyTree', icon: Network },
];

function viewLabel(id: ViewId, t: Strings, isBusinessSpace: boolean): string {
  const map: Partial<Record<ViewId, string>> = {
    profiles: isBusinessSpace ? 'Team' : t.nav_family,
    assistant: t.nav_assistant,
    calendar: t.nav_calendar,
    info: isBusinessSpace ? 'Compliance' : t.nav_info,
    household: isBusinessSpace ? 'Locations' : t.nav_household,
    finances: t.nav_finances,
    timeline: isBusinessSpace ? 'Business timeline' : t.nav_timeline,
    travelTimeline: 'Travel timeline',
    vault: t.nav_documents,
    assets: t.nav_assets,
    passwords: t.nav_passwords,
    familyWords: 'Family Words',
    pets: 'Pets',
    familyTree: 'Family tree',
    inMemory: 'In Memory',
    willsEstate: 'Wills & Estate',
    gifts: 'Gifts & Occasions',
    anniversaries: 'Anniversaries & Special Days',
    extendedBirthdays: 'Extended Birthdays',
  };
  return map[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

// A draggable family-list row where ONLY the grip handle starts a drag
// (dragListener disabled), so tapping or scrolling the card never reorders it.
interface DraggableRowProps {
  member: FamilyMember;
  className: string;
  onSelect: () => void;
  onDragEnd: () => void;
  renderInner: (member: FamilyMember, grip?: React.ReactNode) => React.ReactNode;
}

const DraggableRow: React.FC<DraggableRowProps> = ({ member, className, onSelect, onDragEnd, renderInner }) => {
  const controls = useDragControls();
  const grip = (
    <div
      onPointerDown={(e) => { e.stopPropagation(); controls.start(e); }}
      onClick={(e) => e.stopPropagation()}
      className="cursor-grab active:cursor-grabbing touch-none p-1.5 -ml-1 rounded-lg text-ink-300 hover:text-ink-600 hover:bg-cream-100 shrink-0"
      title="Drag to reorder"
    >
      <GripVertical className="w-4 h-4" />
    </div>
  );
  return (
    <Reorder.Item
      value={member}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      className={className}
    >
      {renderInner(member, grip)}
    </Reorder.Item>
  );
}

interface DashboardProps {
  /** Admin-only gear button injected by AppInner; null when not admin or not signed in */
  familySettingsButton?: React.ReactNode;
  /**
   * Bumped by App.tsx whenever the sibling FamilySettings panel writes the
   * shared HubSettings doc. That panel saves directly to the store, and the
   * settings load below is keyed on the user and the active space — so without
   * this, a preference changed there (the Calendar panels switches especially)
   * was saved correctly and stayed invisible in here until a full reload.
   */
  settingsVersion?: number;
}

export default function Dashboard({ familySettingsButton, settingsVersion = 0 }: DashboardProps = {}) {
  const demo = isDemoMode();
  const { interfacePreference } = useAppearance();
  const emberInterface = interfacePreference === 'ember';
  const { isAdmin: ctxIsAdmin, canWrite: ctxCanWrite, role, aiEligible, aiConsent, setAiConsent, spaces, familyId: activeSpaceId, uid: accountUid, loading: ctxLoading } = useFamilyCtx();
  // Wills & Estate has its own access answer, separate from role — see
  // hooks/useWillsAccess.ts and the carve-out in firestore.rules.
  const { mayRead: mayReadWills, mayWrite: mayWriteWills } = useWillsAccess();

  /* The demo has no account, so it has no spaces list to look itself up in —
     ?demo=business is the only way to see a business space without buying one. */
  const activeSpaceType = demo
    ? demoSpaceType()
    : spaces.find((s) => s.id === activeSpaceId)?.type || 'family';
  const isBusinessSpace = activeSpaceType === 'business';

  /* A demo has no account and so no role. In a BUSINESS space that silently
     picks a side — see demoIsOwner(). Real spaces are untouched: `demo` is
     false for every signed-in user, so ctxIsAdmin is the only answer that
     ever reaches them. */
  const isAdmin = demo ? demoIsOwner() : ctxIsAdmin;
  /* An owner writes. Without this the business demo hid Money and Insurance
     from the person who owns the company — both are filtered on canWrite, not
     on isAdmin (see availableViewItems). Family demos keep ctxCanWrite, which
     is false, exactly as they always have. */
  const canWrite = demo && demoIsOwner() ? true : ctxCanWrite;

  const handleSwitchSpace = async (spaceId: string) => {
    await switchSpace(spaceId);
    window.location.reload();
  };
  // SpaceSwitcher's "Join another space" form calls this — see its own doc
  // comment for why this needs to exist independent of the /join/{code}
  // signed-out flow in FamilyOnboarding.tsx (that one only ever runs for an
  // account with no space yet; this is for everyone else).
  const handleJoinSpace = async (code: string) => {
    await joinFamily(code);
    // SpaceSwitcher reloads the page itself once this promise resolves —
    // matches every other space-changing action (switch, create).
  };
  const handleCreateSpace = async (name: string, extra?: NewBusinessExtra) => {
    await createSpace(name, 'business', extra);

    // Seed the new business with a profile for its creator — otherwise they
    // land on a blank "Add Team Member" prompt for themselves, the obvious
    // first team member. createSpace() already switched FAMILY_ID to the new
    // space before resolving, so this save lands in the right place.
    const user = auth.currentUser;
    if (user) {
      const ownerMember: FamilyMember = {
        id: Date.now().toString(),
        name: user.displayName || user.email?.split('@')[0] || 'Me',
        role: 'Owner',
        email: user.email || undefined,
        avatarColor: AVATAR_COLORS[0],
        avatarUrl: user.photoURL || undefined,
        isOnline: true,
        clothingSizes: {},
        documents: [],
      };
      await saveFamilyMembers([ownerMember]);
    }

    window.location.reload();
  };
  // AI is opt-in and OFF by default. Demo mode always shows it (no real data);
  // otherwise adults must have consented, and child accounts never get AI.
  const canUseAI = demo || (aiEligible && aiConsent);
  const [consentOpen, setConsentOpen] = useState(false);
  const consentPromptedRef = useRef(false);
  useEffect(() => {
    // Prompt eligible adults once per load if they haven't decided yet.
    if (!demo && aiEligible && !aiConsent && !consentPromptedRef.current) {
      consentPromptedRef.current = true;
      setConsentOpen(true);
    }
  }, [demo, aiEligible, aiConsent]);
  const { t } = useT();

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(!demo);

  const [members, setMembers] = useState<FamilyMember[]>([]);
  // Only the contacts array is kept at this top level — just enough for
  // NeedsAttention/OnThisDay's birthday nudges. ImportantInfo's own view still
  // self-loads the full FamilyInfo doc (numbers/contacts/providers) for editing.
  const [contacts, setContacts] = useState<ContactEntry[]>([]);
  const [extendedBirthdayRecords, setExtendedBirthdayRecords] = useState<ExtendedBirthday[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  /* A person from a connected household, shown in the SAME panel as a member.
   * Kept beside selectedMemberId rather than folded into it: a shared person is
   * not a FamilyMember and must never reach the tabs, editors or AI paths that
   * assume one. Selecting either clears the other — one panel, one subject. */
  const [sharedView, setSharedView] = useState<{ member: SharedMember; household: string; linkId?: string } | null>(null);
  /* The connected household as a subject in its own right. Same panel, same
   * one-subject rule: opening a household clears the person and vice versa. */
  const [householdView, setHouseholdView] = useState<{
    link: FamilyLink;
    members: SharedMember[];
    photoUrl?: string;
    namedByThem: NamedByThem | null;
  } | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  /* Collapsed family list. On a phone the list and the profile are stacked, so
     with eight people you scroll past the whole household every time you want
     to look at one of them. Collapsing leaves the selected person visible —
     hiding the list entirely would lose your place, which is the usual failure
     of an accordion here. Per-device, so a phone can stay collapsed while a
     laptop (where the list is a side column that costs nothing) stays open. */
  const [listCollapsed, setListCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('teluva.familyListCollapsed') === '1'; } catch { return false; }
  });
  const [initialFirstJob] = useState<'week' | 'vault' | 'story' | null>(() => {
    if (!emberInterface) return null;
    try {
      const firstJob = localStorage.getItem('teluva.firstJob');
      return firstJob === 'week' || firstJob === 'vault' || firstJob === 'story' ? firstJob : null;
    } catch { return null; }
  });
  useEffect(() => {
    if (!initialFirstJob) return;
    try { localStorage.removeItem('teluva.firstJob'); } catch { /* private browsing */ }
  }, [initialFirstJob]);
  const toggleListCollapsed = () => {
    // Written outside the state updater: React may invoke an updater twice, and
    // a setState callback is not the place for a side effect.
    const next = !listCollapsed;
    try { localStorage.setItem('teluva.familyListCollapsed', next ? '1' : '0'); } catch { /* private mode */ }
    setListCollapsed(next);
  };
  const [buildTimelineOnOpen, setBuildTimelineOnOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [peoplePane, setPeoplePane] = useState<'profiles' | 'todo'>('profiles');
  // Linked households (cousins, nieces, nephews). Everyone can OPEN it — that
  // is the point of it; only an admin sees the connect/share controls inside.
  const [connectedOpen, setConnectedOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addMemberInitialRole, setAddMemberInitialRole] = useState<MemberRole | undefined>();
  const [addingChildFromTree, setAddingChildFromTree] = useState(false);
  const [newTreeChildId, setNewTreeChildId] = useState<string | null>(null);
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);
  const [capturePlanSignal, setCapturePlanSignal] = useState(initialFirstJob === 'week' ? 1 : 0);
  const [captureVaultSignal, setCaptureVaultSignal] = useState(initialFirstJob === 'vault' ? 1 : 0);
  /* A document shared into Teluva from another app's share sheet. It reached
   * the service worker as a POST (see utils/sharedInbox.ts) and is collected
   * here on the load that follows. */
  const [sharedFile, setSharedFile] = useState<File | null>(null);
  const [captureStorySignal, setCaptureStorySignal] = useState(initialFirstJob === 'story' ? 1 : 0);
  const [captureHouseSignal, setCaptureHouseSignal] = useState(0);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [showMemberCalendar, setShowMemberCalendar] = useState(false);
  const [settings, setSettings] = useState<HubSettings>({});
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  /* One control on the avatar, not two. Every app that does this well — Apple,
   * WhatsApp, Facebook, Google — puts a SINGLE small badge on the picture and
   * opens a sheet of labelled options from it; two competing badges on one
   * 96px circle was ours alone. Tapping the photo opens the same sheet, so the
   * obvious gesture works, and "See full size" is the first item rather than
   * something a mis-tap replaces. */
  const [photoMenuFor, setPhotoMenuFor] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<FamilyDocument | null>(null);
  const [selectedDocumentMemberName, setSelectedDocumentMemberName] = useState<string>('');
  const [deleteConfirmMemberId, setDeleteConfirmMemberId] = useState<string | null>(null);

  const [mainView, setMainView] = useState<ViewId>(() => {
    if (demo && new URLSearchParams(window.location.search).get('view') === 'timeline') return 'timeline';
    if (!emberInterface) return 'profiles';
    if (initialFirstJob === 'week') return 'calendar';
    if (initialFirstJob === 'vault') return 'vault';
    if (initialFirstJob === 'story') return 'timeline';
    return 'pulse';
  });

  // Switching presentation systems never reloads or rewrites family data.
  // It only chooses which already-mounted entry surface is visible.
  const previousInterface = useRef(interfacePreference);
  useEffect(() => {
    if (previousInterface.current === interfacePreference) return;
    previousInterface.current = interfacePreference;
    setMainView(interfacePreference === 'ember' ? 'pulse' : 'profiles');
  }, [interfacePreference]);

  // Switching section must put you at the TOP of the new one.
  //
  // Without this, changing view leaves the window scroll exactly where it was,
  // and every section renders into the same always-scrolled <main>. Picking
  // Calendar from the burger while two thousand pixels down the family list
  // dropped you two thousand pixels down the CALENDAR — past the month grid,
  // into the footer — which reads as "I tapped Calendar and it didn't open".
  // Reported as exactly that, and reproduced on a 375px viewport.
  //
  // Skips the very first run: on a reload the browser restores the previous
  // scroll position itself, and yanking the page to the top after it does so
  // would be its own small bug.
  const didMountView = useRef(false);
  useEffect(() => {
    if (!didMountView.current) { didMountView.current = true; return; }
    // 'auto', not 'smooth' — this is a destination change, not a nudge within
    // a page, and a long smooth-scroll past unrelated content on the way to a
    // section you asked for is noise. It also respects reduced-motion for free.
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [mainView]);

  const [restyleMemberId, setRestyleMemberId] = useState<string | null>(null);
  // limitReached: this month's AI-action quota was hit on the last attempt for
  // this member — stops the auto-generate effect below from silently retrying
  // (and re-hitting the limit endpoint) every time the member is re-viewed
  // this session. Session-only; a fresh session/reload tries again naturally.
  const [astroBlurb, setAstroBlurb] = useState<Record<string, { text: string; loading: boolean; error: string | null; limitReached?: boolean }>>({});
  const [legalTab, setLegalTab] = useState<LegalTab | null>(null);
  // Bumped after the AI chatbot applies edits so the self-loading views
  // (household / info / finances / timeline / assets / shopping) remount and
  // re-fetch — otherwise an applied change wouldn't show until a manual reload.
  const [aiDataVersion, setAiDataVersion] = useState(0);
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  // Full-screen feature modals launched from the "Quick actions" row on the
  // family/profiles landing view.
  const [showEmergency, setShowEmergency] = useState(false);
  const [showBabysitter, setShowBabysitter] = useState(false);

  /* Changes the assistant offered but nobody accepted.
     These live in the saved chat with `applied: false`, so they already survive
     closing the app — but they survive INSIDE the chat, which means finding
     them again required knowing to look. Surfaced on the home screen instead,
     as a banner rather than a blocking modal: someone who wants to decline the
     suggestions must be able to get on with their day. */
  const [pendingEditCount, setPendingEditCount] = useState(0);
  const [assistantOpenSignal, setAssistantOpenSignal] = useState(0);

  useEffect(() => {
    if (demo || !currentUser) { setPendingEditCount(0); return; }
    let cancelled = false;
    void loadChatHistory(currentUser.uid).then((history) => {
      if (cancelled || !Array.isArray(history)) return;
      const n = history.reduce(
        (sum, m: { applied?: boolean; edits?: unknown[] }) =>
          sum + (!m.applied && Array.isArray(m.edits) ? m.edits.length : 0),
        0,
      );
      setPendingEditCount(n);
    }).catch(() => { /* a banner is not worth failing a page load over */ });
    return () => { cancelled = true; };
  }, [demo, currentUser]);

  /* Android home-screen shortcuts (manifest `shortcuts`) land here as ?do=…
     Read once on mount and stripped from the URL immediately, so a refresh
     doesn't reopen the overlay and the parameter can't leak into a shared link.
     There is no ?do=scan case: the scanner lives inside a member's Documents
     tab and needs a member chosen first, so that shortcut deliberately opens
     the app rather than pretending. */
  /* Web Share Target arrivals. Mirrors the ?do= handler below — read once on
   * mount, strip the flag from the URL immediately — but the payload lives in
   * the Cache API rather than the query string, because a file cannot travel
   * in a URL.
   *
   * The vault opens with the upload form holding the document. Deliberately
   * NOT filed automatically: which person and which category it belongs to is
   * the whole judgement the vault exists to record, and a share sheet cannot
   * know either. Filing it silently under "Other" against nobody would
   * produce a vault that looks full and answers nothing.
   *
   * Android and ChromeOS only. iOS Safari does not implement Web Share Target
   * at all, so on an iPhone Teluva never appears in the share sheet and this
   * effect simply never fires — which is why the file picker and the
   * drop/paste routes in DocumentVault.tsx are not redundant with it. */
  useEffect(() => {
    const outcome = shareOutcome(window.location.search);
    if (!outcome) return;
    clearShareFlag();
    if (outcome === 'lost') {
      /* The share reached the server instead of the service worker, so the
       * file is gone. Say so — the alternative is opening on a home screen
       * that looks completely normal while the document is nowhere. */
      setToast('That share didn\u2019t reach Teluva. Open the app once, then share it again.');
      return;
    }
    let cancelled = false;
    (async () => {
      const files = await takeSharedFiles();
      if (cancelled || !files.length) return;
      setSharedFile(files[0]);
      setMainView('vault');
      setCaptureVaultSignal((signal) => signal + 1);
      if (files.length > 1) {
        setToast(`Filing the first of ${files.length} — share the rest one at a time.`);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get('do');
    if (!want) return;
    if (want === 'emergency') setShowEmergency(true);
    if (want === 'babysitter') setShowBabysitter(true);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('do');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    } catch { /* history is a nicety here, never worth throwing over */ }
  }, []);
  const [showTravelPack, setShowTravelPack] = useState(false);
  const [showFamilyStats, setShowFamilyStats] = useState(false);
  const [showFamilyQuiz, setShowFamilyQuiz] = useState(false);
  const [showHealthTimeline, setShowHealthTimeline] = useState(false);
  // Set when HealthTimeline is opened FROM a specific member's Medical tab, so
  // it preselects them instead of defaulting to the first family member. The
  // Dashboard's own "Health timeline" quick-action chip (family-wide) leaves
  // this null, and HealthTimeline itself falls back to members[0] in that case.
  const [healthTimelineMemberId, setHealthTimelineMemberId] = useState<string | null>(null);

  // null = no save attempted yet; true/false = last save reached cloud or not
  const [cloudSynced, setCloudSynced] = useState<boolean | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [exportingBackup, setExportingBackup] = useState(false);
  // First-run tour readiness: flips true once the initial members/events/
  // settings load has actually resolved (real data, so the tour's "add your
  // first member" vs "your family" copy is correct instead of guessing while
  // Firestore is still in flight). Set at the end of both the demo and
  // signed-in load paths below. `tourReplayKey` is bumped by "Replay the
  // welcome tour" in Hub settings to force FirstRunTour to run again.
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [tourReplayKey, setTourReplayKey] = useState(0);
  // Guided setup interview (FamilyInterview.tsx) runs BEFORE the first-run tour
  // for a genuinely empty vault — see that file's header comment for why. Gates
  // FirstRunTour's `ready` below so the two never show at once; opens as soon
  // as the interview settles (whether it actually ran or not).
  const [interviewGateOpen, setInterviewGateOpen] = useState(false);
  const [interviewReplayKey, setInterviewReplayKey] = useState(0);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4500);
  };

  useEffect(() => {
    if (demo) {
      const biz = demoSpaceType() === 'business';
      const demoMembers = biz ? DEMO_BUSINESS_MEMBERS : DEMO_MEMBERS;
      setCurrentUser({ displayName: biz ? 'Demo business' : 'Demo family', isDemo: true });
      setMembers(demoMembers);
      setEvents(biz ? DEMO_BUSINESS_EVENTS : DEMO_EVENTS);
      setContacts(biz ? DEMO_BUSINESS_CONTACTS : DEMO_CONTACTS);
      setExtendedBirthdayRecords(biz ? [] : DEMO_EXTENDED_BIRTHDAYS);
      setSelectedMemberId(demoMembers[0].id);
      // The demo exists to show what the app looks like, and the star-sign card
      // is off by default for real vaults (it's opt-in, and not everyone wants
      // it). Switching it on here is the only way anybody sees it before
      // signing up — and the demo family has the birth details to show it
      // properly, including a rising sign.
      setSettings((s) => ({ ...s, astrology: true }));
      setInitialLoadDone(true);
      return;
    }

    // Safety timeout so a blocked auth popup never leaves an infinite spinner
    const timeout = setTimeout(() => setIsAuthLoading(false), 3000);

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthLoading(false);
      clearTimeout(timeout);
    });
    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  // Load family & events when the signed-in user changes. Gated on ctxLoading:
  // this component has its OWN onAuthStateChanged listener (below) that flips
  // currentUser as soon as Firebase resolves a session, but FamilyContext's
  // listener does an ADDITIONAL awaited Firestore read (the user's profile)
  // before it calls setFamilyId() with the ACTIVE space id. Without this gate,
  // on a page refresh while a non-default space (e.g. a business) is active,
  // this effect could fire and load family/calendar/settings data BEFORE
  // FAMILY_ID was corrected from its default — silently reading/showing the
  // wrong space's (usually empty) data. Confirmed live: a refreshed business
  // space showed its uploaded photo as gone. Waiting for ctxLoading===false
  // guarantees FAMILY_ID is already correct by the time these loads fire.
  useEffect(() => {
    if (demo) return;
    if (ctxLoading) return;

    async function init() {
      // Re-armed on every run: this effect refires on space switch, and a stale
      // `true` here would let the previous space's data decide the empty state.
      setInitialLoadDone(false);

      // Paint the last-known family immediately. loadFamilyMembers() below is
      // network-first and can take seconds on a cold start; until it returned,
      // `members` was [] — which the empty-state check cannot tell apart from a
      // genuinely empty family, so an eight-person household was greeted with
      // "Add your first family member".
      if (currentUser) {
        const cached = readCachedFamilyMembers();
        if (cached && cached.length > 0) {
          setMembers(cached);
          setSelectedMemberId((prev) => (prev && cached.some((m) => m.id === prev)) ? prev : cached[0].id);
        }
      }

      if (!currentUser) {
        setMembers([]);
        setEvents([]);
        setContacts([]);
        setInitialLoadDone(true);
        return;
      }

      const data = await loadFamilyMembers();
      if (data && data.length > 0) {
        setMembers(data);
        // Only default to the first member when there's no valid selection yet —
        // this effect re-runs whenever `currentUser` gets a new object reference
        // (Firebase's onAuthStateChanged can refire that on a silent token
        // refresh, e.g. after a backgrounded mobile tab regains focus), and
        // unconditionally resetting here used to snap an already-open profile
        // straight back to the first member on every such refire.
        setSelectedMemberId((prev) => (prev && data.some((m) => m.id === prev)) ? prev : data[0].id);
      } else {
        setMembers([]);
      }

      const calData = await loadCalendarEvents();
      setEvents(calData && calData.length > 0 ? calData : []);

      const hub = await loadSettings();
      if (hub) setSettings(hub);

      const info = await loadFamilyInfo();
      setContacts(info?.contacts || []);
      /* Birthdays for people who aren't family members. The home screen's
       * "Needs attention" and "On this day" cards used to derive these from
       * contacts alone, which stopped being right the moment birthdays moved
       * to their own record — Granny would have quietly dropped off both cards
       * the day her birthday was migrated across. */
      setExtendedBirthdayRecords(await loadExtendedBirthdays());
      setInitialLoadDone(true);
    }
    init();
  }, [currentUser, ctxLoading, activeSpaceId]);

  /* Re-read the shared settings doc after the sibling FamilySettings panel
   * writes it — see DashboardProps.settingsVersion. Deliberately its own
   * effect rather than another dep on init() above: that one reloads members,
   * events, contacts and birthdays too, and flipping one switch should not
   * refetch the whole vault. Skips the initial 0 so this never double-loads
   * on mount, and merges rather than replaces so anything Dashboard itself has
   * saved since (and the store has, therefore, already merged) isn't dropped
   * by a slow read landing late. */
  useEffect(() => {
    if (!settingsVersion) return;
    let cancelled = false;
    loadSettings().then((hub) => {
      if (!cancelled && hub) setSettings((prev) => ({ ...prev, ...hub }));
    }).catch(() => { /* a failed re-read just leaves the old view — the write itself already succeeded */ });
    return () => { cancelled = true; };
  }, [settingsVersion]);

  /* The one list of non-member birthdays the home screen works from: the
   * dedicated records, plus any birthday still sitting on a contact from
   * before v228 moved them (see utils/extendedBirthdaySources.ts). Merging
   * here rather than in each card means the two cards can't disagree, and a
   * person recorded in both places is only ever shown once. */
  const homeExtendedBirthdays = useMemo(
    () => withContactBirthdays(extendedBirthdayRecords, contacts),
    [extendedBirthdayRecords, contacts],
  );

  // The name a family typed at sign-up lives on the membership record, not in
  // HubSettings — see utils/hubName.ts for why the header must read both.
  const activeSpaceName = spaces.find((s) => s.id === activeSpaceId)?.name;
  // The demo has no membership record to carry a creation name, so without this
  // the business demo would head every screen "Business Hub" and demonstrate
  // the generic fallback rather than the product.
  /* The demo company's name is fed in as the space's chosen name rather than
     short-circuiting past hubDisplayName — one derivation path, so the demo
     cannot drift away from the fallback behaviour everyone else gets. */
  const hubName = hubDisplayName(
    demo && isBusinessSpace ? DEMO_BUSINESS_NAME : settings.hubName,
    activeSpaceName,
    isBusinessSpace,
  );
  const emergencyPackScope = {
    ownerUid: accountUid || (demo ? 'demo' : 'unknown-account'),
    spaceId: activeSpaceId || (demo ? 'demo-family' : 'unknown-space'),
    spaceName: hubName,
  };

  // How to render a member's name (fun display preference)
  const memberName = (m: FamilyMember) => {
    const mode = settings.nameDisplay || 'both';
    if (mode === 'nick') return m.nickname || m.name;
    if (mode === 'real') return m.name;
    return m.nickname ? `${m.name} “${m.nickname}”` : m.name;
  };

  /* The family's list of people whose dates nobody sees
   * (HubSettings.hiddenDatePeople — see contexts/HiddenPeopleContext.tsx).
   * Saved with the settings it was read from as the merge base, so the save
   * says "this list changed" and nothing else: a feed another member added a
   * minute ago, or someone they hid on their own phone, is kept. Read through a
   * ref so a hide straight after another settings change never works from the
   * copy before it. */
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const saveFamilyHiddenDates = useCallback(async (change: (list: HiddenDatePerson[]) => HiddenDatePerson[]) => {
    if (demo) return false;
    const base = settingsRef.current;
    const next: HubSettings = { ...base, hiddenDatePeople: change(base.hiddenDatePeople || []) };
    const ok = await saveSettings(next, base);
    if (ok) {
      settingsRef.current = next;
      setSettings(next);
    }
    return ok;
  }, [demo]);

  /* "Choose who" — people an admin has hidden from chosen accounts only
   * (HubSettings.hiddenDatePeopleFor, v355). Exactly the same shape as the
   * family list above and for the same reason: the base it was read from goes
   * in as the merge base and the rest of the settings are spread through, so
   * the only thing this save can change is this one list. A rebuilt settings
   * object that forgot a key would be read by the merge as a DELETE of it. */
  const saveHiddenDatesFor = useCallback(async (change: (list: HiddenDatePersonFor[]) => HiddenDatePersonFor[]) => {
    if (demo) return false;
    const base = settingsRef.current;
    const next: HubSettings = { ...base, hiddenDatePeopleFor: change(base.hiddenDatePeopleFor || []) };
    const ok = await saveSettings(next, base);
    if (ok) {
      settingsRef.current = next;
      setSettings(next);
    }
    return ok;
  }, [demo]);
  /* "Change who" (v356) moves a person between the family list and the
   * chosen-accounts list, so both change in ONE save: the same base-plus-spread
   * as the two saves above, with both keys set from the same base. Two saves
   * in a row could leave the person on both lists, or on neither. */
  const saveHiddenDateLists = useCallback(async (change: (lists: SettingsHiddenLists) => SettingsHiddenLists) => {
    if (demo) return false;
    const base = settingsRef.current;
    const lists = change({ family: base.hiddenDatePeople || [], forSome: base.hiddenDatePeopleFor || [] });
    const next: HubSettings = { ...base, hiddenDatePeople: lists.family, hiddenDatePeopleFor: lists.forSome };
    const ok = await saveSettings(next, base);
    if (ok) {
      settingsRef.current = next;
      setSettings(next);
    }
    return ok;
  }, [demo]);
  /* The family's sign-in accounts for the "Choose who" checklist: the roles
     collection a member may read (firestore.rules), or the demo's four. */
  const loadHideAccounts = useCallback(
    () => (demo ? Promise.resolve(DEMO_ACCOUNT_ROLES) : activeSpaceId ? loadFamilyRoles(activeSpaceId) : Promise.resolve({})),
    [demo, activeSpaceId],
  );

  const handleSaveSettings = async (next: HubSettings) => {
    const trimmedName = (next.hubName || '').trim();
    const nameChanged = isAdmin && trimmedName && trimmedName !== (settings.hubName || '').trim();
    setSettings(next);
    setIsSettingsOpen(false);
    if (!demo) {
      await saveSettings(next);
      if (nameChanged) {
        try {
          await renameSpace(trimmedName);
          window.location.reload(); // keep the space switcher's cached name in sync everywhere
        } catch (e) {
          console.error('Could not sync the new name to the space switcher:', e);
        }
      }
    }
  };

  // Drag-to-reorder the family list. onReorder updates live; we persist the
  // new order (the saved metadata.ids array preserves it) when the drag ends.
  const membersRef = useRef(members);
  useEffect(() => { membersRef.current = members; }, [members]);
  // Same stale-closure defence for events: AIChatbot's Apply now calls
  // handleApplyAiEdits TWICE in one tick (data edits, then trip_attach after
  // fileScans), and the second call's `events` closure would still be the
  // pre-first-call state. Kept fresh eagerly at every write, like membersRef.
  const eventsRef = useRef(events);
  useEffect(() => { eventsRef.current = events; }, [events]);

  const handleReorder = (newOrder: FamilyMember[]) => {
    setMembers(newOrder);
    membersRef.current = newOrder;
  };

  const saveOrder = async () => {
    if (demo) return;
    const ok = await saveFamilyMembers(membersRef.current);
    setCloudSynced(ok);
    if (!ok) showToast("Saved on this device — couldn't back up to the cloud. Check your connection and re-save.");
  };

  const cardClass = (member: FamilyMember) =>
    `w-full text-left rounded-2xl border transition-all flex items-center justify-between ${emberInterface ? 'ember-person-card ' : ''}${
      selectedMemberId === member.id ? 'p-3.5' : 'py-2 px-3'
    } ${
      selectedMemberId === member.id
        ? 'border-clay-300 bg-clay-50 ring-1 ring-clay-200'
        : 'border-cream-200 bg-white hover:bg-cream-100 hover:border-cream-300'
    }`;

  // Inner content of a family-list card. `grip` (when provided) is the drag
  // handle node — only it starts a drag, so tapping/scrolling the card is safe.
  // Non-selected members render as a compact single row (avatar + name only);
  // the selected member keeps the full detail rendering (chips, subtitle, delete).
  const memberCardInner = (member: FamilyMember, grip?: React.ReactNode) => {
    const isSelected = selectedMemberId === member.id;
    const today = new Date().toLocaleDateString('en-CA');
    const nextMemberEvent = emberInterface
      ? events
          .filter(event => event.date >= today && event.memberIds?.includes(member.id))
          .sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`))[0]
      : undefined;

    if (!isSelected) {
      return (
        <div className="flex items-center gap-2 min-w-0">
          {grip}
          {member.avatarUrl ? (
            <div className="avatar-ring shrink-0">
              <div className="w-9 h-9 rounded-full overflow-hidden">
                <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover" />
              </div>
            </div>
          ) : (
            <div className="avatar-ring shrink-0">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs text-white uppercase ${warmAvatarColor(member.avatarColor)}`}>
                {member.name.charAt(0).toUpperCase()}
              </div>
            </div>
          )}
          <span className="min-w-0 grid">
            <b className="text-sm font-semibold text-ink-900 truncate">{memberName(member)}</b>
            {emberInterface && (
              <small className="mt-0.5 text-[10px] text-ink-400 truncate">
                {nextMemberEvent
                  ? `${member.role} · Next: ${nextMemberEvent.title} · ${nextMemberEvent.date}`
                  : `${member.role} · Nothing pressing on their horizon`}
              </small>
            )}
          </span>
        </div>
      );
    }

    return (
      <>
        <div className="flex items-center gap-2 min-w-0">
          {grip}
          {member.avatarUrl ? (
            <div className="avatar-ring shrink-0">
              <div
                onClick={(e) => { e.stopPropagation(); setLightboxImage(member.avatarUrl!); }}
                onPointerDownCapture={(e) => e.stopPropagation()}
                className="w-14 h-14 rounded-full overflow-hidden cursor-zoom-in"
                title="View photo"
              >
                <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover" />
              </div>
            </div>
          ) : (
            <div className="avatar-ring shrink-0">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center font-bold text-lg text-white uppercase ${warmAvatarColor(member.avatarColor)}`}>
                {member.name.charAt(0).toUpperCase()}
              </div>
            </div>
          )}
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-ink-900 truncate flex items-center gap-1.5 flex-wrap">
              <span>{memberName(member)}</span>
              <span className="chip bg-cream-200 text-ink-600">{member.role}</span>
              {member.birthdate && (
                <span className="chip bg-dusk-100 text-dusk-700 tabular-nums">{calculateAge(member.birthdate)}</span>
              )}
            </h4>
            {(() => {
              const parts: string[] = [];
              if (member.medical?.bloodGroup) parts.push(member.medical.bloodGroup);
              if (member.role === 'Child' && member.education?.schoolName) parts.push(member.education.schoolName);
              if (member.medical?.allergies) parts.push(`⚠ ${member.medical.allergies}`);
              const docCount = member.documents?.length || 0;
              if (docCount > 0 && parts.length < 2) parts.push(`${docCount} doc${docCount !== 1 ? 's' : ''}`);
              return parts.length > 0 ? (
                <p className="text-[11px] text-ink-400 font-medium truncate mt-0.5 tabular-nums">{parts.join(' · ')}</p>
              ) : null;
            })()}
          </div>
        </div>

        {isAdmin && (
          <div onClick={(e) => e.stopPropagation()} onPointerDownCapture={(e) => e.stopPropagation()} className="relative flex items-center shrink-0">
            {deleteConfirmMemberId === member.id ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleDeleteMember(member.id)}
                  className="px-2.5 py-1.5 bg-rosa-500 hover:bg-rosa-700 text-white rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  Remove
                </button>
                <button
                  onClick={() => setDeleteConfirmMemberId(null)}
                  className="px-2 py-1.5 border border-cream-300 text-ink-500 rounded-lg bg-white hover:bg-cream-100 text-[11px] font-semibold cursor-pointer"
                >
                  Keep
                </button>
              </div>
            ) : (
              <button
                onClick={() => setDeleteConfirmMemberId(member.id)}
                className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg transition-colors cursor-pointer"
                title="Remove member"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </>
    );
  };

  const persistChanges = async (updated: FamilyMember[]) => {
    membersRef.current = updated; // keep the ref fresh NOW so a following write in
    setMembers(updated);          // the same tick (e.g. scan → passport then document) merges
    if (demo) return;
    const ok = await saveFamilyMembers(updated);
    setCloudSynced(ok);
    if (!ok) showToast("Saved on this device — couldn't back up to the cloud. Check your connection and re-save.");
  };

  // Apply an AI-restyled avatar. The real photo is stashed once in
  // avatarOriginalUrl so "reset to photo" always works and styles never stack.
  const handleRestyleApply = async (memberId: string, dataUrl: string, style: string) => {
    const compressed = await compressImageToAvatar(dataUrl);
    const updated = members.map((m) =>
      m.id === memberId
        ? { ...m, avatarOriginalUrl: m.avatarOriginalUrl || m.avatarUrl, avatarUrl: compressed, avatarStyle: style }
        : m,
    );
    await persistChanges(updated);
  };

  const handleRestyleReset = async (memberId: string) => {
    const updated = members.map((m) =>
      m.id === memberId && m.avatarOriginalUrl
        ? { ...m, avatarUrl: m.avatarOriginalUrl, avatarOriginalUrl: undefined, avatarStyle: undefined }
        : m,
    );
    await persistChanges(updated);
  };

  // Re-rolls the "Star sign" card's blurb via Gemini. Persisted onto the member
  // (astrologyBlurb) so it survives a reload instead of reverting to the plain
  // static fallback every session — the whole point of this card being a
  // reason to come back. astroBlurb (component state) still exists too, for
  // the in-flight loading/error UI, but the source of truth after a successful
  // generation is the persisted member field.
  const shuffleAstrology = async (memberId: string) => {
    const member = membersRef.current.find((m) => m.id === memberId);
    if (!member) return;
    // One meaningful insight per member per local calendar day — every call
    // below is a paid Gemini request; unlimited reshuffling cheapens the
    // writing. A genuine input change (birth time/place added) still earns a
    // fresh one, same condition the auto-generate effect below uses.
    const capInputs = blurbCacheKey(member);
    if (member.astrologyBlurb && member.astrologyBlurb.forInputs === capInputs && isSameLocalDay(member.astrologyBlurb.generatedAt)) return;
    const previousBlurb = member.astrologyBlurb?.text || astroBlurb[memberId]?.text || undefined;
    setAstroBlurb((s) => ({ ...s, [memberId]: { text: s[memberId]?.text || previousBlurb || '', loading: true, error: null } }));
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Please sign in again.');
      const token = await user.getIdToken();
      const res = await fetch('/api/astrology-blurb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          birthdate: member.birthdate, birthTime: member.birthTime, placeOfBirth: member.placeOfBirth, previousBlurb,
          // Only signs we are actually sure of. An uncertain moon or rising is
          // omitted entirely rather than sent as a maybe — the server prompt
          // then tells the model not to mention it, so the blurb never states
          // something the app itself couldn't determine.
          chart: (() => {
            const c = computeBirthChart({
              birthdate: member.birthdate, birthTime: member.birthTime,
              birthTimeZone: member.birthTimeZone,
              birthLatitude: member.birthLatitude, birthLongitude: member.birthLongitude,
            });
            return {
              moon: c.moon.certainty === 'exact' ? c.moon.sign : undefined,
              rising: c.rising.certainty === 'exact' ? c.rising.sign : undefined,
            };
          })(),
        }),
      });
      const data = await res.json();
      // Monthly AI-action limit reached — a normal, expected state (the
      // message already says so plainly and that everything else still
      // works), not a broken-app error. Tag it so the auto-generate effect
      // below stops silently retrying every time this member is re-viewed.
      if (res.status === 402 && data?.limitReached) {
        setAstroBlurb((s) => ({ ...s, [memberId]: { text: s[memberId]?.text || '', loading: false, error: data.error, limitReached: true } }));
        return;
      }
      if (!res.ok || !data.blurb) throw new Error(data.error || 'Could not generate a blurb.');
      setAstroBlurb((s) => ({ ...s, [memberId]: { text: data.blurb, loading: false, error: null } }));
      const forInputs = blurbCacheKey(member);
      const astrologyBlurb = { text: data.blurb, sign: data.sign, generatedAt: new Date().toISOString(), forInputs };
      await persistChanges(membersRef.current.map((m) => (m.id === memberId ? { ...m, astrologyBlurb } : m)));
    } catch (e) {
      setAstroBlurb((s) => ({
        ...s,
        [memberId]: { text: s[memberId]?.text || '', loading: false, error: e instanceof Error ? e.message : 'Something went wrong.' },
      }));
    }
  };

  const handleSaveEvents = async (updatedEvents: CalendarEvent[]) => {
    setEvents(updatedEvents);
    if (demo) return;
    const ok = await saveCalendarEvents(updatedEvents);
    setCloudSynced(ok);
    if (!ok) showToast("Saved on this device — couldn't back up to the cloud. Check your connection and re-save.");
  };

  // "Whose is this?" answered on a person's Medical / Check-ups screen. Built
  // on eventsRef (fresh at every write) so two quick taps on two different
  // appointments don't each save a list missing the other's tag.
  const handleTagEventToMember = (eventId: string, memberId: string) => {
    const next = tagEventToMember(eventsRef.current, eventId, memberId);
    eventsRef.current = next;
    void handleSaveEvents(next);
  };

  // Pure UX de-dupe for the batch-cap warning below — stops it re-toasting
  // on every unrelated `events` change while the app is "stuck" above the
  // cap, and resets once the stuck condition clears. It plays no part in
  // correctness: the never-push-history and never-double-push guarantees
  // are enforced entirely by the persisted HubSettings.autoSyncBaselineIds
  // snapshot and CalendarEvent.googleSynced flag (see isEligibleForAutoSync
  // in utils/googleCalendarSync.ts), neither of which this ref touches.
  const autoSyncCapWarnedRef = useRef(false);

  // AUTOMATIC OUTBOUND SYNC — pushes newly-created Teluva events to the
  // owner's connected Google Calendar when HubSettings.autoSyncEventsToGoogle
  // is on (toggle lives in FamilyCalendar.tsx's Sync Panel; captured/
  // persisted via onToggleAutoSync just above).
  //
  // THIS DELIBERATELY LIVES HERE, NOT IN FamilyCalendar.tsx. An earlier
  // version put the whole thing in FamilyCalendar, watching `events` with a
  // React ref tracking "ids seen so far." That was broken for the exact
  // scenario this feature exists for: FamilyCalendar only mounts while
  // `mainView === 'calendar'` (see the render below), so an event the AI
  // chat added while the user was on the Profiles tab was never "seen" —
  // and the moment the user next opened Calendar, the ref started fresh,
  // silently folding that already-pending event into its new "this is
  // history" baseline. It was never pushed, ever. Dashboard, by contrast,
  // is mounted for the app's entire session no matter which tab is showing,
  // and it already owns `events` directly — no prop drilling needed.
  //
  // Getting the Google token here does NOT duplicate FamilyCalendar's
  // connect/refresh flow: getAccessToken() (imported from utils/firebase.ts
  // above) just reads the same module-level cache googleSignIn() already
  // populates when the user connects from the Sync Panel. If nobody has
  // connected yet, it resolves to null and this effect quietly no-ops.
  //
  // CORRECTNESS HERE DOES NOT DEPEND ON *WHEN* THIS EFFECT RUNS, only on it
  // eventually running again while the app is open. isEligibleForAutoSync
  // is a pure function of the event, the persisted autoSyncBaselineIds
  // snapshot, and the persisted googleSynced flag — there is no "did I
  // already look at this" in-memory state that a remount, tab switch, or
  // reload could lose. Practically: an event created while this effect
  // couldn't reach Google (app closed, offline, not yet connected) still
  // syncs the next time `events` changes after that condition clears — for
  // the common case (Dashboard already open and connected when the AI chat
  // adds the event) that's within moments of the save; there can be a
  // real delay for the "app wasn't open" case, and that's an accepted,
  // stated trade-off rather than a silent gap.
  useEffect(() => {
    if (demo) return; // never send fabricated demo appointments to a real Google account
    if (!settings.autoSyncEventsToGoogle) return;

    // A MISSING baseline is not an empty one. The two are written together in
    // one settings object when the toggle flips on, so this should never
    // happen — but if it ever did (a partial write, a doc hand-edited in the
    // console, a future migration that adds the flag without the snapshot),
    // treating `undefined` as "an empty set" would mean every event in the
    // family's history looks newly-created and gets pushed to a real Google
    // Calendar. There is no undo for that. Absent baseline therefore means
    // "not initialised" and syncs NOTHING, which the user can fix by toggling
    // off and on again to re-snapshot.
    if (!Array.isArray(settings.autoSyncBaselineIds)) return;
    const baseline = new Set<string>(settings.autoSyncBaselineIds);
    const eligible = events.filter(ev => isEligibleForAutoSync(ev, baseline));
    if (eligible.length === 0) {
      autoSyncCapWarnedRef.current = false;
      return;
    }

    // Same restore-from-backup backstop as the original design: a burst
    // this large in one go is far more likely to be the "restore from
    // backup" flow below (which calls this same handleSaveEvents path,
    // wholesale-replacing `events`) than someone adding an appointment.
    // Refuses to auto-push any of them — "Export all events" on the
    // Calendar tab (which shows an honest count and asks for confirmation)
    // is the correct tool for a deliberate bulk send.
    const AUTO_SYNC_BATCH_CAP = 15;
    if (eligible.length > AUTO_SYNC_BATCH_CAP) {
      if (!autoSyncCapWarnedRef.current) {
        autoSyncCapWarnedRef.current = true;
        showToast(`${eligible.length} events are pending Google Calendar sync at once (likely a restore, not a new appointment) — skipped auto-sync for all of them. Use "Export all events" on the Calendar tab if you want to send them.`);
      }
      return;
    }

    let cancelled = false;
    (async () => {
      const token = await getAccessToken();
      if (!token || cancelled) return; // not connected right now — will retry once `events` next changes or the user reconnects

      const syncedIds = new Set<string>();
      let authExpired = false;
      for (const ev of eligible) {
        try {
          await pushEventToGoogleCalendar(ev, token, { business: isBusinessSpace });
          syncedIds.add(ev.id);
        } catch (err) {
          console.error('Auto-sync to Google Calendar failed for event ' + ev.id, err);
          if (err instanceof GoogleCalendarAuthError) {
            authExpired = true;
            break; // token is known bad now — stop, don't burn the rest of the batch against it
          }
          // Any other failure: leave this one event un-synced (it stays
          // eligible and gets retried on a future run) and keep going with
          // the rest of the batch rather than letting one bad event block
          // everything else in it.
        }
      }
      if (cancelled) return;
      if (syncedIds.size > 0) {
        await handleSaveEvents(events.map(e => (syncedIds.has(e.id) ? { ...e, googleSynced: true } : e)));
      }
      if (authExpired) {
        invalidateAccessToken();
        showToast('Google Calendar authorization expired — new events are still saved in Family Hub, but stopped syncing. Reconnect on the Calendar tab to resume.');
      }
    })();
    return () => { cancelled = true; };
    // handleSaveEvents/showToast intentionally excluded: both are stable
    // per render via closures over state already listed below, and this
    // effect's own handleSaveEvents call is guarded against re-triggering
    // itself via the persisted googleSynced flag (once true, the event
    // drops out of `eligible` on the very next run), not via a dependency
    // omission trick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, settings.autoSyncEventsToGoogle, settings.autoSyncBaselineIds, demo, isBusinessSpace]);

  // START-UP GOOGLE CALENDAR IMPORT (inbound — the reverse of the above).
  //
  // Rory, 2026-09-13: two appointments in his Google Calendar never reached
  // Teluva, because the import only ran when the Calendar SCREEN mounted, and
  // he lives on the dashboard and the chat. So the same import now also runs
  // here, once per space load, when the last one on this device is older
  // than a few hours — see shouldImportOnStartup in
  // utils/googleCalendarImport.ts for exactly who it runs for.
  //
  // SILENT OR NOT AT ALL. getAccessToken() is the silent path only (GIS
  // `prompt: ''`, the scopes already granted, no new scopes): no consent
  // screen, no popup. When Google won't hand a token over silently — no
  // Google session in this browser, or the grant was withdrawn — nothing is
  // imported and a quiet line says how stale the calendar is, with a Refresh
  // button. Only that button, pressed by the person, may open a popup.
  const [googleSyncNote, setGoogleSyncNote] = useState<string | null>(null);
  const [googleRefreshing, setGoogleRefreshing] = useState(false);
  const startupImportKeyRef = useRef<string | null>(null);
  const activeSpaceRef = useRef(activeSpaceId);
  useEffect(() => { activeSpaceRef.current = activeSpaceId; }, [activeSpaceId]);

  /** Import into the space that was active when it started; true when it ran. */
  const runGoogleImport = async (token: string): Promise<boolean> => {
    const spaceAtStart = activeSpaceRef.current;
    const uid = auth.currentUser?.uid;
    try {
      const res = await importGoogleEvents(token, eventsRef.current, membersRef.current);
      if (!res) return true; // the Calendar screen is importing right now — that counts
      // Switched space mid-import: these belong to the space the person left,
      // and saving them now would write them into the one they switched to.
      if (activeSpaceRef.current !== spaceAtStart) return false;
      writeLastGoogleImport(uid, spaceAtStart);
      // Re-checked against the list as it is NOW, not as it was when the
      // fetch began: the seconds in between are enough for another write.
      const have = new Set(eventsRef.current.map((e) => e.id));
      const fresh = res.fresh.filter((e) => !have.has(e.id));
      if (fresh.length > 0) {
        const next = [...eventsRef.current, ...fresh];
        eventsRef.current = next;
        await handleSaveEvents(next);
      }
      return true;
    } catch (err) {
      console.error('Google Calendar import failed', err);
      if (err instanceof GoogleImportAuthError) invalidateAccessToken();
      return false;
    }
  };

  useEffect(() => {
    if (!initialLoadDone) return;
    const uid: string | undefined = currentUser?.uid;
    const key = `${uid || ''}:${activeSpaceId || ''}`;
    if (startupImportKeyRef.current === key) return;
    startupImportKeyRef.current = key;
    const lastIso = readLastGoogleImport(uid, activeSpaceId);
    const due = shouldImportOnStartup({
      demo,
      uid,
      isBusinessSpace,
      disconnected: isGoogleDisconnected(),
      lastIso,
      hasGoogleEvents: hasGoogleImportedEvents(eventsRef.current),
      nowMs: Date.now(),
    });
    if (!due) { setGoogleSyncNote(null); return; }
    void (async () => {
      const token = await getAccessToken(); // silent only — never a popup
      const ok = token ? await runGoogleImport(token) : false;
      if (startupImportKeyRef.current !== key) return; // space or person changed meanwhile
      setGoogleSyncNote(ok ? null : staleSyncNote(lastIso, Date.now()));
    })();
    // runGoogleImport reads everything through refs; listing it would re-run
    // this on every render for nothing (the key ref makes it once per load).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoadDone, currentUser, activeSpaceId, isBusinessSpace, demo]);

  // The Calendar screen's own import (on opening it, or its Import button)
  // also records the time — once it has, the stale line has nothing to say.
  useEffect(() => {
    if (!googleSyncNote) return;
    if (!isGoogleImportStale(readLastGoogleImport(currentUser?.uid, activeSpaceId), Date.now())) setGoogleSyncNote(null);
  }, [events, mainView, googleSyncNote, currentUser, activeSpaceId]);

  // The Refresh on the quiet line. A click, so a popup is allowed here if
  // that is the only way Google will give a token.
  const handleGoogleRefresh = async () => {
    setGoogleRefreshing(true);
    try {
      const token = await connectGoogleAccess();
      if (!token) { showToast('Google didn’t connect — try again from the Calendar screen.'); return; }
      const ok = await runGoogleImport(token);
      if (ok) {
        setGoogleSyncNote(null);
        showToast('Google Calendar is up to date.');
      } else {
        showToast('Couldn’t bring in your Google Calendar just now.');
      }
    } finally {
      setGoogleRefreshing(false);
    }
  };

  const handleAddMember = async (newMember: Omit<FamilyMember, 'documents'>) => {
    const shouldReturnToTree = addingChildFromTree && newMember.role === 'Child';
    const fullMember: FamilyMember = { ...newMember, documents: [] };
    const updated = [...members, fullMember];
    await persistChanges(updated);
    setSelectedMemberId(fullMember.id);
    if (shouldReturnToTree) {
      setNewTreeChildId(fullMember.id);
      setAiDataVersion(v => v + 1);
      setMainView('familyTree');
    }
    setAddingChildFromTree(false);
  };

  const handleDeleteMember = async (id: string) => {
    const updated = members.filter(m => m.id !== id);
    await persistChanges(updated);
    setDeleteConfirmMemberId(null);
    if (selectedMemberId === id) {
      setSelectedMemberId(updated.length > 0 ? updated[0].id : '');
    }
  };

  const handleUpdateSizes = async (memberId: string, sizes: ClothingSizes) => {
    await persistChanges(members.map(m => (m.id === memberId ? { ...m, clothingSizes: sizes } : m)));
  };


  // Generic patch for the selected member — used by the medical/ids/travel/preferences tabs
  const handlePatchSelectedMember = async (patch: Partial<FamilyMember>) => {
    if (!selectedMemberId) return;
    await persistChanges(members.map(m => (m.id === selectedMemberId ? { ...m, ...patch } : m)));
  };

  // Same as handlePatchSelectedMember, but for a member that isn't necessarily
  // the one currently open — the guided setup interview (FamilyInterview.tsx)
  // walks through several people in one sitting, not just whichever profile
  // happens to be selected.
  const handlePatchMember = async (memberId: string, patch: Partial<FamilyMember>) => {
    await persistChanges(members.map(m => (m.id === memberId ? { ...m, ...patch } : m)));
  };

  // Apply edits proposed by the AI assistant (after the user confirms).
  // Throws if any cloud save fails so the chatbot doesn't mark the message
  // as "Applied" when data didn't actually reach Firestore.
  const handleApplyAiEdits = async (edits: AiEdit[]): Promise<UndoRecord[]> => {
    const failures: string[] = [];
    // Refusals are NOT failures: nothing went wrong, the person simply isn't
    // allowed to change that thing. Kept apart so the message can say so
    // instead of blaming the network (see the throw at the end).
    const refusals: string[] = [];
    // Undo manifest: the ids of the records this Apply CREATES, learned by
    // diffing each domain's collection before vs. after (the pure apply helpers
    // mint ids internally, so this is the only non-invasive way to recover them).
    // Only pushed when the save succeeded, so the manifest never references a
    // record that isn't actually in the cloud. Documents are captured separately
    // in fileScans (AIChatbot) — they don't flow through this handler.
    const undo: UndoRecord[] = [];

    if (hasMemberEdits(edits)) {
      const before = membersRef.current;
      // `skipped` names any member/passport/etc. edit whose "member" text
      // resolveMember couldn't pin down to exactly one person (no match, or
      // an ambiguous one) — surfaced here the same way applyDestructiveEdits'
      // own notes are, so a card that quietly changed nothing for one of its
      // edits doesn't just read "Applied ✓" (found 2026-08-15, chat-function
      // audit).
      const { members: next, skipped } = applyMemberEdits(before, edits, isBusinessSpace);
      membersRef.current = next; // so a following fileScans→handleAddDocument merges onto this
      setMembers(next);
      const ok = await saveFamilyMembers(next);
      if (!ok) failures.push('family members');
      else undo.push(...diffMemberUndo(before, next));
      if (skipped.length) { console.warn('AI member edit:', skipped.join(' ')); showToast(skipped.join(' ')); }
    }
    if (hasInfoEdits(edits)) {
      const info = (await loadFamilyInfo()) || { numbers: [], contacts: [], providers: [] };
      const updatedInfo = applyInfoEdits(info, edits);
      const ok = await saveFamilyInfo(updatedInfo);
      if (!ok) failures.push('contacts & numbers');
      else undo.push(...diffInfoUndo(info, updatedInfo));
      // Keep NeedsAttention/OnThisDay's contact-birthday nudges current — they
      // read the top-level `contacts` state (a prop), not a self-load like
      // ImportantInfo's own view, so an AI-added contact needs this explicit push.
      setContacts(updatedInfo.contacts || []);
    }
    if (hasCalendarEdits(edits)) {
      // membersRef.current, not `members` — a new_member edit earlier in this
      // same batch already landed there (line 1078) but won't reach the
      // `members` state variable until the next render, so a calendar_event
      // for that brand-new person would fail to tag them (2026-08-17 audit).
      const before = eventsRef.current;
      const next = applyCalendarEdits(before, edits, membersRef.current, { business: isBusinessSpace });
      eventsRef.current = next; // fresh NOW — a trip_attach in the same tick builds on this
      setEvents(next);
      const ok = await saveCalendarEvents(next);
      if (!ok) failures.push('calendar');
      else undo.push(...mapNewIds(before, next, 'calendar', (e) => e.title || 'event'));
    }
    if (hasTripAttachEdits(edits)) {
      // Attach EXISTING vault documents to a trip's travel pack. Vault docs are
      // loaded fresh (not from tripVaultDocs state — the pack may never have
      // been opened, and a document filed by fileScans milliseconds ago must be
      // visible). eventsRef, not `events`: this runs as AIChatbot's SECOND
      // onApplyEdits call in one tick, after the calendar block above may have
      // already advanced the events in the first call.
      let vault: VaultDocument[] = [];
      try { vault = await loadDocuments(); } catch { vault = []; }
      const res = applyTripAttachEdits(eventsRef.current, edits, membersRef.current, vault);
      if (res.attached.length) {
        eventsRef.current = res.events;
        setEvents(res.events);
        const ok = await saveCalendarEvents(res.events);
        if (!ok) failures.push('travel pack');
        // Attaching mutates an existing event rather than creating a record, so
        // there's nothing for the undo manifest — Remove on the pack card is the undo.
      }
      if (res.notes.length) showToast(res.notes.join(' '));
    }
    if (hasHouseholdEdits(edits) || hasServiceRecordEdits(edits) || hasHomeServiceEdits(edits) || hasPetHealthEdits(edits)) {
      const h = (await loadHousehold()) || {};
      // The vendor directory lives in the OTHER document, and is read here for
      // one purpose only: turning "the plumber was Hofer" into a link to the
      // Hofer row. Loaded lazily so a batch with no house work doesn't pay for
      // a second read, and never written back — see applyHomeServiceEdits.
      const vendorDirectory = hasHomeServiceEdits(edits)
        ? ((await loadFamilyInfo())?.vendors || [])
        : [];
      // Apply household list_add/household_set first (so a vehicle added in the
      // same batch exists), then append any scanned service records onto the
      // matching vehicle, then any work done on the house. One save covers all.
      const h2 = applyHomeServiceEdits(applyHouseholdEdits(h, edits), edits, vendorDirectory);
      // Pet medical history runs AFTER applyHouseholdEdits for the same reason
      // the service records do: "we got a puppy, Nala, and she had her first
      // jabs today" is a list_add and a pet_health edit in one batch, and the
      // pet has to exist before a record can be filed against her.
      const { household: h3, matched: petMatched, unmatched: petUnmatched } = applyPetHealthEdits(h2, edits);
      const { vehicles, matched, unmatched } = applyServiceRecordEdits(h3.vehicles || [], edits);
      // If service records named a vehicle that isn't on file AND there is
      // nothing else to save from this batch, tell the user plainly instead of
      // dropping the data. Throw BEFORE saving so a retry can't double-add
      // (nothing was persisted yet); when other edits or matched records exist
      // we save them and let the assistant's reply mention any it couldn't place.
      if (unmatched.length && matched === 0 && !hasHouseholdEdits(edits) && !hasHomeServiceEdits(edits)) {
        throw new Error(`I couldn't find a vehicle on file matching ${unmatched.join(', ')}. Add that vehicle first (or check the plate on the document), then scan the service history again.`);
      }
      // Same rule for pets, and it matters more here: pets are matched by NAME
      // alone, so a typo or a nickname is the difference between filing a vet
      // bill and losing it. Saying so beats silently dropping it.
      if (petUnmatched.length && petMatched === 0 && !hasHouseholdEdits(edits) && !hasHomeServiceEdits(edits) && matched === 0) {
        throw new Error(`I couldn't find a pet on file called ${petUnmatched.join(', ')}. Add them under Household → Pets first, then tell me again and I'll file it.`);
      }
      const after = { ...h3, vehicles };
      const ok = await saveHousehold(after);
      if (!ok) failures.push('household');
      else undo.push(...diffHouseholdUndo(h, after));
    }
    if (hasFinancesEdits(edits)) {
      const f = (await loadFinances()) || {};
      const after = applyFinancesEdits(f, edits);
      const ok = await saveFinances(after);
      if (!ok) failures.push('finances');
      else undo.push(...diffFinancesUndo(f, after));
    }
    if (hasTimelineEdits(edits)) {
      const t = (await loadTimeline()) || { entries: [] };
      const { timeline: after, notes } = applyTimelineEdits(t, edits, membersRef.current);
      // `t` is the base: only the rows added here are this write's change.
      const ok = await saveTimeline(after, t);
      if (!ok) failures.push('timeline');
      else undo.push(...mapNewIds(t.entries, after.entries, 'timeline', (e: any) => e.title || e.type || 'timeline entry'));
      if (notes.length) { console.warn('AI timeline edit:', notes.join(' ')); showToast(notes.join(' ')); }
    }
    if (hasFamilyWordsEdits(edits)) {
      const doc = (await loadFamilyWords()) || { words: [] };
      const after = applyFamilyWordsEdits(doc.words || [], edits);
      const ok = await saveFamilyWords({ words: after });
      if (!ok) failures.push('family words');
      else undo.push(...mapNewIds(doc.words, after, 'familyWord', (w: any) => w.word || 'word'));
    }
    if (hasShoppingEdits(edits)) {
      const s = await loadShopping();
      const after = applyShoppingEdits(s, edits);
      const ok = await saveShopping(after);
      if (!ok) failures.push('shopping');
      else undo.push(...mapNewIds(s, after, 'shopping', (x: any) => x.name || 'item'));
    }
    if (hasAssetEdits(edits)) {
      const VALID_CATS: AssetItem['category'][] = ['Electronics', 'Appliance', 'Bike', 'Sporting', 'Vehicle', 'Jewellery', 'Furniture', 'Other'];
      for (const e of edits) {
        if (e.kind !== 'asset') continue;
        const cat = VALID_CATS.includes(e.category as AssetItem['category'])
          ? (e.category as AssetItem['category'])
          : 'Other';
        const asset: AssetItem = {
          id: Date.now().toString() + Math.floor(Math.random() * 1000),
          name: e.name || 'Unnamed',
          category: cat,
          assignedMember: e.assignedMember || undefined,
          make: e.make || undefined,
          model: e.model || undefined,
          serialNumber: e.serialNumber || undefined,
          purchaseDate: e.purchaseDate || undefined,
          purchasePrice: e.purchasePrice || undefined,
          notes: e.notes || undefined,
          photoDataUrl: e.photoUrl || undefined,
          createdAt: new Date().toISOString().slice(0, 10),
        };
        const ok = await saveAsset(asset);
        if (!ok) failures.push('assets');
        else undo.push({ domain: 'asset', id: asset.id, label: asset.name });
      }
    }
    if (hasRecipeEdits(edits)) {
      const current = await loadRecipes();
      const after = applyRecipeEdits(current, edits);
      const ok = await saveRecipes(after);
      if (!ok) failures.push('recipes');
      else undo.push(...mapNewIds(current, after, 'recipe', (r: any) => r.title || 'recipe'));
    }
    if (hasAnniversaryEdits(edits)) {
      const current = await loadAnniversaries();
      const after = applyAnniversaryEdits(current, edits, membersRef.current);
      const ok = await saveAnniversaries(after);
      if (!ok) failures.push('anniversaries');
      else undo.push(...mapNewIds(current, after, 'anniversary', (a: any) => a.title || 'anniversary'));
    }
    if (hasExtendedBirthdayEdits(edits)) {
      const current = await loadExtendedBirthdays();
      const after = applyExtendedBirthdayEdits(current, edits);
      const ok = await saveExtendedBirthdays(after, current);
      if (!ok) failures.push('extended birthdays');
      else {
        // Unlike its sibling doc above, this list is also rendered on the home
        // screen ("Needs attention" / "On this day"), which works off state
        // loaded once per space. Without this, telling the assistant about
        // Granny's birthday would update the Extended Birthdays screen and
        // leave the home screen showing the old list until the next reload.
        setExtendedBirthdayRecords(after);
        undo.push(...mapNewIds(current, after, 'extendedBirthday', (b: any) => `${b.name}'s birthday`));
      }
    }
    // All three parts of the wills & estate doc are loaded, applied and saved in
    // ONE write. They are siblings on the same Firestore document, and
    // saveReferenceDoc diffs `value` against `base` to work out the writer's
    // intent — so saving `{ records }` alone reads as "the successor and the
    // instructions were deleted" and silently drops them. Passing `doc` as the
    // explicit base as well means the merge sees exactly what this screen was
    // built from rather than whatever getSeen happens to be holding.
    if (hasEstateEdits(edits) || hasSuccessorEdits(edits) || hasInstructionsEdits(edits)) {
      // Writing this document is admins-only since v230. Without this branch a
      // non-admin's estate edit fell through to the write, got refused by the
      // rule, and was reported as "couldn't be saved to the cloud — check your
      // connection" — which is not what happened and sends them to fix the
      // wrong thing. Say the actual reason.
      if (!mayWriteWills) {
        refusals.push('Wills & Estate can only be changed by an admin of this space');
      } else {
      const doc = (await loadWillsEstate()) || { records: [] };
      const after = hasEstateEdits(edits) ? applyEstateEdits(doc.records || [], edits) : (doc.records || []);
      const successor = hasSuccessorEdits(edits) ? applySuccessorEdit(doc.successor, edits) : doc.successor;
      const instructions = hasInstructionsEdits(edits) ? applyInstructionsEdit(doc.instructions, edits) : doc.instructions;
      const ok = await saveWillsEstate({ ...doc, records: after, successor, instructions }, doc);
      if (!ok) failures.push('wills & estate');
      else undo.push(...mapNewIds(doc.records, after, 'estate', (r: any) => r.kind || 'estate record'));
      }
    }
    if (hasSlipEdits(edits)) {
      const current = await loadSlips();
      const after = applySlipEdits(current, edits);
      const ok = await saveSlips(after);
      if (!ok) failures.push('slips');
      else undo.push(...mapNewIds(current, after, 'slip', (s: any) => s.item || 'slip'));
    }
    // The one-line family status (HubSettings.status) — the sixth instance of
    // this codebase's own named bug class, "invisible to the AI": it shipped
    // with a dedicated UI but was never wired into the edit pipeline until
    // now. `settings` doubles as both the merge base and the value-with-one-
    // field-changed, so saveSettings's diff sees ONLY status as this write's
    // intent — everything else on the doc (calendarFeeds, country, etc.) is
    // left exactly as the server already has it, never overwritten.
    if (hasStatusEdits(edits)) {
      const authorName = currentUser?.displayName || currentUser?.email || 'Someone';
      const nextStatus = applyStatusEdit(settings.status, edits, authorName);
      const nextSettings = { ...settings, status: nextStatus };
      const ok = await saveSettings(nextSettings, settings);
      if (!ok) failures.push('family status');
      else setSettings(nextSettings);
    }
    // DESTRUCTIVE edits (delete_record / update_record) run LAST — after every
    // create/append above has been saved — so applyDestructiveEdits re-resolves
    // each target id against the freshest saved data and can't act on a record a
    // same-batch edit just changed. This ONLY runs because the user tapped Apply
    // on a card that spelled out exactly WHAT and WHOSE record would change
    // (confirm-before-destroy). Document deletes route through
    // deleteDocumentEverywhere so both stores + Storage are cleaned; ids that no
    // longer resolve are dropped with a note, never substituted.
    if (hasDestructiveEdits(edits)) {
      const res = await applyDestructiveEdits(edits, membersRef.current);
      if (res.members) { membersRef.current = res.members; setMembers(res.members); }
      if (res.contacts) setContacts(res.contacts);
      if (res.notes.length) {
        console.warn('AI delete/update:', res.notes.join(' '));
        showToast(res.notes.join(' '));
      }
      if (res.failures.length) failures.push(...res.failures);
    }

    // Remount the self-loading views so an applied change shows immediately
    // (these views load their data once on mount and take no props).
    if (
      hasInfoEdits(edits) || hasHouseholdEdits(edits) || hasFinancesEdits(edits) ||
      hasTimelineEdits(edits) || hasShoppingEdits(edits) || hasAssetEdits(edits) ||
      hasFamilyWordsEdits(edits) || hasRecipeEdits(edits) || hasAnniversaryEdits(edits) || hasEstateEdits(edits) || hasSlipEdits(edits) ||
      hasSuccessorEdits(edits) || hasInstructionsEdits(edits) ||
      hasServiceRecordEdits(edits) || hasHomeServiceEdits(edits) || hasPetHealthEdits(edits) || hasDestructiveEdits(edits)
    ) {
      setAiDataVersion(v => v + 1);
    }

    if (failures.length > 0 || refusals.length > 0) {
      // A failure partway through (say, finances after members already saved)
      // used to throw a plain Error with nothing about what had already
      // landed. AIChatbot's catch left the card un-applied — still showing
      // "Apply" — so a well-meaning retry re-submitted the ENTIRE edits[]
      // array from scratch: every append-only domain above (new members,
      // contacts, calendar events, household/finances rows, timeline,
      // shopping, assets, recipes, estate records, …) has no id-based
      // idempotency, so whatever already saved got duplicated (found
      // 2026-08-15, chat-function audit). `undo` above only ever gained an
      // entry from a domain block whose `ok` was true, so at THIS point it is
      // an accurate manifest of exactly what already saved — attach it to the
      // thrown error so the caller can mark the card applied (Apply →
      // Applied+Undo) instead of leaving it retry-ready. Undo removes the
      // partial saves first; a re-apply after that is clean, same as any
      // other Undo→re-apply cycle.
      const parts: string[] = [];
      if (failures.length > 0) {
        parts.push(
          `Some of this couldn't be saved to the cloud (${failures.join(', ')}) — but the rest already did. `
          + `Check your connection, then use Undo on this card before trying again, so nothing gets saved twice.`,
        );
      }
      if (refusals.length > 0) {
        parts.push(`${refusals.join('; ')}. Everything else was saved.`);
      }
      const err: any = new Error(parts.join(' '));
      err.partialUndo = undo;
      throw err;
    }
    return undo;
  };

  // Reverse the MOST RECENT apply of a chat card: delete exactly the records its
  // manifest names (member profiles, nested member records, calendar/list rows,
  // vault documents, …) and report how many were removed vs. couldn't be found.
  // Each domain is reloaded fresh, the target ids are filtered out, and the rest
  // saved back — append-only filing means removing these ids restores the prior
  // state. Documents route through deleteDocumentEverywhere (the SAME helper the
  // delete screens use) so the vault copy, every member-profile copy, and the
  // Storage object all go together — never a half-deleted orphan.
  const handleUndoAiEdits = async (records: UndoRecord[]): Promise<{ undone: number; missing: number }> => {
    let undone = 0;
    let missing = 0;
    const tally = (present: Set<string>, targets: Set<string>) => {
      for (const id of targets) { if (present.has(id)) undone++; else missing++; }
    };
    const idsFor = (...ds: UndoDomain[]) => new Set(records.filter(r => ds.includes(r.domain)).map(r => r.id));

    // --- Members: whole new profiles + nested records + transit passes ---
    if (records.some(r => r.domain === 'member' || r.domain === 'memberNested' || r.domain === 'transitPass' || r.domain === 'vaccination' || r.domain === 'visa' || r.domain === 'guardian')) {
      const removeMemberIds = idsFor('member');
      const beforeIds = new Set(membersRef.current.map(m => m.id));
      for (const id of removeMemberIds) { if (beforeIds.has(id)) undone++; else missing++; }
      let next = membersRef.current.filter(m => !removeMemberIds.has(m.id));
      next = next.map(m => {
        let mm = m;
        for (const r of records) {
          if (r.memberId !== m.id) continue;
          if (r.domain === 'memberNested' && r.collection) {
            const arr = (mm as any)[r.collection] as { id: string }[] | undefined;
            if (arr?.some(x => x.id === r.id)) { mm = { ...mm, [r.collection]: arr.filter(x => x.id !== r.id) }; undone++; }
            else missing++;
          } else if (r.domain === 'transitPass') {
            const arr = mm.travel?.transitPasses;
            if (arr?.some(x => x.id === r.id)) { mm = { ...mm, travel: { ...mm.travel, transitPasses: arr.filter(x => x.id !== r.id) } }; undone++; }
            else missing++;
          } else if (r.domain === 'vaccination') {
            const arr = mm.medical?.vaccinations;
            if (arr?.some(x => x.id === r.id)) { mm = { ...mm, medical: { ...mm.medical, vaccinations: arr.filter(x => x.id !== r.id) } }; undone++; }
            else missing++;
          } else if (r.domain === 'visa') {
            const arr = mm.travel?.visas;
            if (arr?.some(x => x.id === r.id)) { mm = { ...mm, travel: { ...mm.travel, visas: arr.filter(x => x.id !== r.id) } }; undone++; }
            else missing++;
          } else if (r.domain === 'guardian') {
            const arr = mm.nonResidentGuardians;
            if (arr?.some(x => x.id === r.id)) { mm = { ...mm, nonResidentGuardians: arr.filter(x => x.id !== r.id) }; undone++; }
            else missing++;
          }
        }
        return mm;
      });
      await persistChanges(next);
    }

    // --- Contacts / numbers / providers / household vendors ---
    // nextInfo is built by removeUndoneInfoRecords (aiUndo.ts), which SPREADS
    // the loaded document rather than rebuilding it key by key. Rebuilding is
    // what made this a data-loss path: saveFamilyInfo merges against what this
    // client last saw, so a key that was in the base and missing from the value
    // reads as a delete — and the three keys named here were written before
    // `vendors` existed.
    const contactIds = idsFor('contact'), numberIds = idsFor('number'), providerIds = idsFor('provider'), vendorIds = idsFor('vendor');
    if (contactIds.size || numberIds.size || providerIds.size || vendorIds.size) {
      const info = (await loadFamilyInfo()) || { numbers: [], contacts: [], providers: [], vendors: [] };
      tally(new Set((info.contacts || []).map(c => c.id)), contactIds);
      tally(new Set((info.numbers || []).map(n => n.id)), numberIds);
      tally(new Set((info.providers || []).map(p => p.id)), providerIds);
      tally(new Set((info.vendors || []).map(v => v.id)), vendorIds);
      const nextInfo = removeUndoneInfoRecords(info, {
        contacts: contactIds, numbers: numberIds, providers: providerIds, vendors: vendorIds,
      });
      await saveFamilyInfo(nextInfo);
      setContacts(nextInfo.contacts);
    }

    // --- Calendar events ---
    const calIds = idsFor('calendar');
    if (calIds.size) {
      const current = await loadCalendarEvents();
      tally(new Set(current.map(e => e.id)), calIds);
      const next = current.filter(e => !calIds.has(e.id));
      await saveCalendarEvents(next);
      setEvents(next);
    }

    // --- Household: vehicles / pets / utilities + vehicle & house work logs ---
    const vehIds = idsFor('vehicle'), petIds = idsFor('pet'), utilIds = idsFor('utility');
    const homeSvcIds = idsFor('homeService');
    const serviceRecs = records.filter(r => r.domain === 'serviceRecord');
    const petHealthRecs = records.filter(r => r.domain === 'petHealth');
    if (vehIds.size || petIds.size || utilIds.size || homeSvcIds.size || serviceRecs.length || petHealthRecs.length) {
      const h = (await loadHousehold()) || {};
      tally(new Set((h.vehicles || []).map(v => v.id)), vehIds);
      tally(new Set((h.pets || []).map(p => p.id)), petIds);
      tally(new Set((h.utilities || []).map(u => u.id)), utilIds);
      tally(new Set((h.homeServiceLog || []).map(r => r.id)), homeSvcIds);
      let vehicles = (h.vehicles || []).filter(v => !vehIds.has(v.id));
      const byVeh = new Map<string, Set<string>>();
      for (const r of serviceRecs) {
        if (!r.parentId) { missing++; continue; }
        if (!byVeh.has(r.parentId)) byVeh.set(r.parentId, new Set());
        byVeh.get(r.parentId)!.add(r.id);
      }
      vehicles = vehicles.map(v => {
        const rm = byVeh.get(v.id);
        if (!rm) return v;
        tally(new Set((v.serviceLog || []).map(s => s.id)), rm);
        byVeh.delete(v.id);
        return { ...v, serviceLog: (v.serviceLog || []).filter(s => !rm.has(s.id)) };
      });
      // Service records whose vehicle no longer exists — count as not-found.
      for (const rm of byVeh.values()) for (const _ of rm) missing++;
      // Pet medical-history entries, same shape one store over: keyed by the
      // pet they hang off, and undone one entry at a time.
      let pets = (h.pets || []).filter(p => !petIds.has(p.id));
      const byPet = new Map<string, Set<string>>();
      for (const r of petHealthRecs) {
        if (!r.parentId) { missing++; continue; }
        if (!byPet.has(r.parentId)) byPet.set(r.parentId, new Set());
        byPet.get(r.parentId)!.add(r.id);
      }
      pets = pets.map(p => {
        const rm = byPet.get(p.id);
        if (!rm) return p;
        tally(new Set((p.healthLog || []).map(r => r.id)), rm);
        byPet.delete(p.id);
        return { ...p, healthLog: (p.healthLog || []).filter(r => !rm.has(r.id)) };
      });
      for (const rm of byPet.values()) for (const _ of rm) missing++;
      // ...h first, and it is load-bearing: this document is three-way-merged
      // on save, so any household key not named here would be read as a
      // deletion. That is exactly how the info doc's `vendors` list was being
      // wiped by an unrelated undo until v236.
      await saveHousehold({
        ...h,
        vehicles,
        pets,
        utilities: (h.utilities || []).filter(u => !utilIds.has(u.id)),
        homeServiceLog: (h.homeServiceLog || []).filter(r => !homeSvcIds.has(r.id)),
      });
    }

    // --- Finances: banks / insurance / benefits ---
    const bankIds = idsFor('bank'), insIds = idsFor('insurance'), benIds = idsFor('benefit');
    if (bankIds.size || insIds.size || benIds.size) {
      const f = (await loadFinances()) || {};
      tally(new Set((f.banks || []).map(b => b.id)), bankIds);
      tally(new Set((f.insurance || []).map(i => i.id)), insIds);
      tally(new Set((f.benefits || []).map(b => b.id)), benIds);
      await saveFinances({
        ...f,
        banks: (f.banks || []).filter(b => !bankIds.has(b.id)),
        insurance: (f.insurance || []).filter(i => !insIds.has(i.id)),
        benefits: (f.benefits || []).filter(b => !benIds.has(b.id)),
      });
    }

    // --- Simple single-list stores ---
    const tlIds = idsFor('timeline');
    if (tlIds.size) {
      const doc = (await loadTimeline()) || { entries: [] };
      tally(new Set((doc.entries || []).map(e => e.id)), tlIds);
      await saveTimeline({ ...doc, entries: (doc.entries || []).filter(e => !tlIds.has(e.id)) }, doc);
    }
    const fwIds = idsFor('familyWord');
    if (fwIds.size) {
      const doc = (await loadFamilyWords()) || { words: [] };
      tally(new Set((doc.words || []).map(w => w.id)), fwIds);
      await saveFamilyWords({ words: (doc.words || []).filter(w => !fwIds.has(w.id)) });
    }
    const shopIds = idsFor('shopping');
    if (shopIds.size) {
      const current = await loadShopping();
      tally(new Set(current.map(s => s.id)), shopIds);
      await saveShopping(current.filter(s => !shopIds.has(s.id)));
    }
    const recipeIds = idsFor('recipe');
    if (recipeIds.size) {
      const current = await loadRecipes();
      tally(new Set(current.map(r => r.id)), recipeIds);
      await saveRecipes(current.filter(r => !recipeIds.has(r.id)));
    }
    const anniversaryIds = idsFor('anniversary');
    if (anniversaryIds.size) {
      const current = await loadAnniversaries();
      tally(new Set(current.map(a => a.id)), anniversaryIds);
      await saveAnniversaries(current.filter(a => !anniversaryIds.has(a.id)));
    }
    const extendedBirthdayIds = idsFor('extendedBirthday');
    if (extendedBirthdayIds.size) {
      const current = await loadExtendedBirthdays();
      tally(new Set(current.map(b => b.id)), extendedBirthdayIds);
      const after = current.filter(b => !extendedBirthdayIds.has(b.id));
      await saveExtendedBirthdays(after, current);
      setExtendedBirthdayRecords(after);   // home screen too — see the apply path
    }
    const estateIds = idsFor('estate');
    // Can only be non-empty for someone who successfully applied estate edits,
    // i.e. an admin — but guarded anyway so an undo never fires a write the
    // rule will refuse and then reports the delete as done.
    if (estateIds.size && mayWriteWills) {
      const doc = (await loadWillsEstate()) || { records: [] };
      tally(new Set((doc.records || []).map(r => r.id)), estateIds);
      // Same three-siblings-one-document gotcha as the apply path above: saving
      // `{ records }` alone reads to saveReferenceDoc's merge as "successor and
      // instructions were deleted". Spread `doc` into the value and pass it as
      // the explicit base so only `records` actually changes.
      await saveWillsEstate({ ...doc, records: (doc.records || []).filter(r => !estateIds.has(r.id)) }, doc);
    }
    const slipIds = idsFor('slip');
    if (slipIds.size) {
      const current = await loadSlips();
      tally(new Set(current.map(s => s.id)), slipIds);
      await saveSlips(current.filter(s => !slipIds.has(s.id)));
    }

    // --- Assets (one doc each) ---
    const assetIds = idsFor('asset');
    if (assetIds.size) {
      const current = await loadAssets();
      const present = new Set(current.map(a => a.id));
      tally(present, assetIds);
      for (const id of assetIds) if (present.has(id)) await deleteAsset(id);
    }

    // --- Documents: route through deleteDocumentEverywhere so vault copy,
    // member-profile copies, and the Storage object all go together. Thread the
    // members list through each call (it strips the profile copies and returns
    // the next members) and persist once at the end. ---
    const docRecords = records.filter(r => r.domain === 'document');
    if (docRecords.length) {
      let vault: VaultDocument[] = [];
      try { vault = await loadDocuments(); } catch { vault = []; }
      const byId = new Map(vault.map(d => [d.id, d]));
      let workingMembers = membersRef.current;
      for (const r of docRecords) {
        const vaultDoc = byId.get(r.id);
        if (!vaultDoc) { missing++; continue; }
        const res = await deleteDocumentEverywhere({ vaultDoc, members: workingMembers });
        workingMembers = res.members;
        undone++;
      }
      await persistChanges(workingMembers);
    }

    // Refresh the self-loading views so the removals show immediately.
    setAiDataVersion(v => v + 1);
    return { undone, missing };
  };

  const handleAddDocument = async (memberId: string, docToAdd: FamilyDocument) => {
    await persistChanges(membersRef.current.map(m => (m.id === memberId ? { ...m, documents: [...(m.documents || []), docToAdd] } : m)));
  };

  // Same shape as handleAddDocument, for the Referrals & Results copy the
  // assistant now files alongside the vault and profile copies.
  const handleAddReferral = async (memberId: string, rec: ReferralRecord) => {
    await persistChanges(membersRef.current.map(m => (m.id === memberId ? { ...m, referrals: [...(m.referrals || []), rec] } : m)));
  };

  // Deleting from a profile must ALSO clear the shared vault copy and the file
  // in Storage. It used to only filter member.documents, so the vault kept a
  // ghost — and the AI's duplicate check reads the vault, so re-uploading a
  // fresh scan of the same document was refused as a duplicate of something
  // the user had already deleted. deleteDocumentEverywhere() owns that logic
  // for BOTH delete screens so the two stores can't drift apart again.
  const handleDeleteDocument = async (memberId: string, docId: string) => {
    const current = membersRef.current;
    const memberDoc = current.find(m => m.id === memberId)?.documents?.find(d => d.id === docId);
    if (!memberDoc) return;
    const result = await deleteDocumentEverywhere({ memberDoc, memberId, members: current });
    await persistChanges(result.members);
    if (result.notes.length) console.warn('Document delete:', result.notes.join(' '));
    if (result.vaultSaveFailed) showToast("Deleted here, but the shared vault couldn't be updated. Check your connection.");
  };

  const handleUpdateMember = async (updatedMember: FamilyMember) => {
    await persistChanges(members.map(m => (m.id === updatedMember.id ? updatedMember : m)));
  };

  const handleViewDocument = (docToView: FamilyDocument, memberName: string) => {
    setSelectedDocument(docToView);
    setSelectedDocumentMemberName(memberName);
  };

  // Downloads a .zip: the full data as JSON, PLUS the actual document/photo
  // FILES themselves (not just downloadUrl links, which 404 once the account
  // and its Storage files are gone — see /api/delete-family). Reuses the same
  // fetch+zip machinery as the Document Vault's bulk export (utils/share.ts
  // downloadZip, already used by DocumentVault.tsx's "zip selected" button).
  //
  // Saved PASSWORDS are a deliberate exclusion, not an oversight: decrypting
  // them into a plaintext file that lands in someone's Downloads folder is
  // arguably worse than not exporting them at all. That choice is recorded
  // in the JSON itself (passwordVault.included = false) and in the button's
  // tooltip below, rather than silently omitted.
  // A folder the assistant offered to gather. Vault documents and the provider
  // directory are NOT kept in Dashboard state — they are loaded on demand
  // elsewhere too — so they are fetched here, once, when an export is actually
  // asked for. A failure to load either is survivable: the pack is built from
  // whatever did load and the confirm screen shows the real counts, so the user
  // sees a short list rather than being told everything is there when it isn't.
  const [exportRequest, setExportRequest] = useState<PackRequest | null>(null);
  // Mount ExportPackModal once, the first time it's actually needed, and never
  // unmount it again for the rest of the session — see the lazy import below
  // for why "mounted" and "needed" have to be different things here (jsPDF).
  const [exportEverRequested, setExportEverRequested] = useState(false);
  useEffect(() => { if (exportRequest) setExportEverRequested(true); }, [exportRequest]);
  const [exportVaultDocs, setExportVaultDocs] = useState<VaultDocument[]>([]);
  const [exportProviders, setExportProviders] = useState<HealthcareProvider[]>([]);

  const handlePrepareExport = async (request: PackRequest) => {
    setExportRequest(request);
    try {
      const [docs, info] = await Promise.all([
        loadDocuments().catch(() => []),
        loadFamilyInfo().catch(() => null),
      ]);
      setExportVaultDocs(docs || []);
      setExportProviders(info?.providers || []);
    } catch {
      setExportVaultDocs([]);
      setExportProviders([]);
    }
  };

  const handleExportAllData = async () => {
    setExportingBackup(true);
    try {
      const [info, household, finances, timeline, docs, willsEstate, inMemory, slips, assets, recipes, shopping] = await Promise.all([
        loadFamilyInfo(),
        loadHousehold(),
        loadFinances(),
        loadTimeline(),
        loadDocuments(),
        loadWillsEstate(),
        loadInMemory(),
        loadSlips(),
        loadAssets(),
        loadRecipes(),
        loadShopping(),
      ]);

      // Document metadata still travels in the JSON (search/reference use) —
      // the actual bytes go into the zip below via fileItems.
      const documentsMeta = (docs || []).map(d => ({
        id: d.id,
        name: d.name,
        category: d.category,
        memberId: d.memberId,
        fileName: d.fileName,
        fileType: d.fileType,
        fileSize: d.fileSize,
        uploadedAt: d.uploadedAt,
        uploadedBy: d.uploadedBy,
        storagePath: d.storagePath,
        // downloadUrl is deliberately NOT written here. A Firebase Storage
        // download URL carries a permanent bearer token that bypasses
        // storage.rules, so a backup file forwarded to anyone — an accountant,
        // a family member, a cloud drive — handed over live world-readable
        // links to every passport scan it contained. The files themselves are
        // in the zip, so the link adds nothing an import needs.
      }));

      const backupData = {
        version: 3,
        exportedAt: new Date().toISOString(),
        author: 'Teluva backup',
        members,
        calendarEvents: events,
        info: info || null,
        household: household || null,
        finances: finances || null,
        timeline: timeline || null,
        documents: documentsMeta,
        willsEstate: willsEstate || null,
        inMemory: inMemory || null,
        slips: slips || [],
        assets: assets || [],
        recipes: recipes || [],
        shopping: shopping || [],
        settings,
        passwordVault: {
          included: false,
          reason: 'Saved passwords are deliberately left out of this download — decrypted secrets should not sit in a plain file in your Downloads folder. Copy them individually from the Passwords tab if you need them elsewhere.',
        },
      };
      const dataStr = JSON.stringify(backupData, null, 2);

      // Real files to bundle alongside the JSON: shared vault documents, the
      // In Memory archive's documents + portraits, slip photos, and recipe
      // photos — every place this app stores an actual file, not just a link.
      const fileItems: { src: string; name: string }[] = [];
      (docs || []).forEach((d) => {
        if (d.downloadUrl) fileItems.push({ src: d.downloadUrl, name: `documents/${d.fileName || d.name}` });
      });
      (inMemory?.people || []).forEach((p) => {
        (p.documents || []).forEach((doc) => {
          if (doc.downloadUrl) fileItems.push({ src: doc.downloadUrl, name: `in-memory/${p.name}/${doc.fileName || doc.name}` });
        });
        if (p.photoUrl) fileItems.push({ src: p.photoUrl, name: `in-memory/${p.name}/portrait.jpg` });
      });
      (slips || []).forEach((s) => {
        if (s.photoUrl) fileItems.push({ src: s.photoUrl, name: `slips/${s.item || s.id}.jpg` });
      });
      (recipes || []).forEach((r) => {
        if (r.photoUrl) fileItems.push({ src: r.photoUrl, name: `recipes/${r.title || r.id}.jpg` });
      });

      const exportFileDefaultName = `family_vault_backup_${new Date().toLocaleDateString('en-CA')}.zip`;
      await downloadZip(fileItems, exportFileDefaultName, [{ name: 'family_vault_data.json', content: dataStr }]);
    } catch (error) {
      console.error('Export failed:', error);
      showToast('Could not generate the backup file.');
    } finally {
      setExportingBackup(false);
    }
  };

  // Remove ONLY the caller's own access — everyone else's data is untouched.
  // Server refuses if the caller is the family's only admin (or only member).
  const handleLeaveFamily = async () => {
    const label = isBusinessSpace ? 'this business' : 'this family';
    const ok = await appConfirm(`Leave ${label}? You'll lose access to its data — this cannot be undone from your side. Everyone else's data stays intact.`, { danger: true, confirmLabel: 'Leave' });
    if (!ok) return;
    try {
      await leaveFamily();
      window.location.reload();
    } catch (err: any) {
      showToast(err?.message || 'Could not leave. Please try again.');
    }
  };

  // Reads a backup file and returns the records inside it.
  //
  // Two formats, because a backup taken before v125 must still restore:
  //   .zip  — the current export. Records live in family_vault_data.json;
  //           the document/photo FILES sit alongside it in folders.
  //   .json — the pre-v125 export, a single JSON file.
  const readBackupFile = async (file: File): Promise<any> => {
    const isZip = file.name.toLowerCase().endsWith('.zip')
      || file.type === 'application/zip'
      || file.type === 'application/x-zip-compressed';
    if (!isZip) return JSON.parse(await file.text());

    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(file);
    // Tolerate the entry sitting inside a wrapper folder, which is what some
    // unzip-and-rezip round trips produce.
    const entry = zip.file('family_vault_data.json')
      || zip.file(/(^|\/)family_vault_data\.json$/)[0];
    if (!entry) {
      throw new Error('no-data-entry');
    }
    return JSON.parse(await entry.async('string'));
  };

  const handleImportAllData = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Be accurate about what this does. Records in the backup are written over
    // the current ones; anything you have now that ISN'T in the backup survives,
    // because the save layer merges rather than replacing wholesale (that change
    // is what stopped two family members overwriting each other). Promising a
    // clean "replace" here would be a lie, and a costly one to act on.
    const ok = await appConfirm(
      'Restore from this backup?\n\n'
      + 'Anything in the file will be written over what you have now. Records you added since the backup was taken are kept, not removed.\n\n'
      + 'This cannot be undone.',
      { danger: true, confirmLabel: 'Restore' }
    );
    if (!ok) { event.target.value = ''; return; }

    (async () => {
      try {
        const backupData = await readBackupFile(file);

        if (backupData.members && Array.isArray(backupData.members)) {
          await persistChanges(backupData.members);
          if (backupData.members.length > 0) setSelectedMemberId(backupData.members[0].id);
        }

        if (backupData.calendarEvents && Array.isArray(backupData.calendarEvents)) {
          await handleSaveEvents(backupData.calendarEvents);
        }

        // v2 sections — only restore if present in the backup
        if (backupData.info && typeof backupData.info === 'object') {
          await saveFamilyInfo(backupData.info);
        }
        if (backupData.household && typeof backupData.household === 'object') {
          await saveHousehold(backupData.household);
        }
        if (backupData.finances && typeof backupData.finances === 'object') {
          await saveFinances(backupData.finances);
        }
        if (backupData.timeline && typeof backupData.timeline === 'object') {
          await saveTimeline(backupData.timeline);
        }
        if (backupData.documents && Array.isArray(backupData.documents)) {
          await saveDocuments(backupData.documents);
        }
        if (backupData.settings && typeof backupData.settings === 'object') {
          await saveSettings(backupData.settings);
          setSettings(backupData.settings);
        }

        // Say what did NOT happen. The zip also contains the document and
        // photo FILES, and those are not re-uploaded — the records come back
        // pointing at storage that may no longer hold them. Better the user
        // knows to keep the zip than discovers a dead thumbnail later.
        showToast('Backup restored. Document files in the zip are your copy — they are not re-uploaded.');
      } catch (error) {
        console.error('Import failed:', error);
        showToast(
          error instanceof Error && error.message === 'no-data-entry'
            ? "That zip doesn't contain family_vault_data.json — is it a Family Vault backup?"
            : "Couldn't read that backup file — is it a Teluva export?"
        );
      }
    })();
    event.target.value = '';
  };

  const selectedMember = members.find(m => m.id === selectedMemberId);

  // Mirrors the guard inside shuffleAstrology so the dice button can show its
  // calm "today's is set" state proactively, before the user even taps it.
  const astrologyCappedToday = !!selectedMember?.astrologyBlurb
    && selectedMember.astrologyBlurb.forInputs === blurbCacheKey(selectedMember)
    && isSameLocalDay(selectedMember.astrologyBlurb.generatedAt);

  // Auto-generate (lazily, once per stale/missing state) the first time a
  // member with a birthdate is viewed, instead of requiring an explicit dice
  // click before the card ever shows anything more than the plain fallback —
  // also re-fires automatically if birthdate/birthTime/placeOfBirth changed
  // since the stored blurb was generated (fixes a blurb going stale silently
  // after an edit) or if it's over 30 days old (keeps the card feeling alive).
  useEffect(() => {
    if (!settings.astrology || !isAdmin || !canUseAI || !selectedMember) return;
    const zodiac = sunSign(selectedMember.birthdate);
    if (!zodiac) return;
    if (astroBlurb[selectedMember.id]?.loading) return;
    // Already told this session it's out of AI actions for the month — don't
    // keep re-hitting the endpoint every time this member is re-viewed.
    if (astroBlurb[selectedMember.id]?.limitReached) return;
    const forInputs = blurbCacheKey(selectedMember);
    const stored = selectedMember.astrologyBlurb;
    const isFresh = !!stored && stored.forInputs === forInputs
      && Date.now() - new Date(stored.generatedAt).getTime() < STALE_ASTROLOGY_MS;
    if (isFresh) {
      if (astroBlurb[selectedMember.id]?.text !== stored!.text) {
        setAstroBlurb((s) => ({ ...s, [selectedMember.id]: { text: stored!.text, loading: false, error: null } }));
      }
      return;
    }
    shuffleAstrology(selectedMember.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMember?.id, selectedMember?.birthdate, selectedMember?.birthTime, selectedMember?.placeOfBirth, selectedMember?.birthTimeZone, selectedMember?.birthLatitude, selectedMember?.birthLongitude, settings.astrology, isAdmin, canUseAI]);

  // Open every member on their Overview summary (like iOS Contacts) — resets when
  // you switch members, so you no longer always land on the Medical form. A
  // pending-tab ref lets a "Needs attention" nudge deep-link to a specific tab.
  const pendingTabRef = useRef<TabId | null>(null);
  useEffect(() => {
    setActiveTab(pendingTabRef.current ?? 'overview');
    pendingTabRef.current = null;
  }, [selectedMemberId]);

  /* Bring the member panel into view when something deep-links into it.
   *
   * Declared AFTER the [mainView] effect above deliberately: that one yanks the
   * page to the top on a view change, and when a deep-link changes both at once
   * the later effect is the one that gets the last word. 'auto' for the same
   * reason it gives: this is a destination, and smooth-scrolling past two
   * thousand pixels of unrelated cards to reach it is noise. scroll-mt-24 on
   * the section keeps the heading clear of the sticky header. */
  const memberPanelRef = useRef<HTMLElement | null>(null);
  const [memberJumpSignal, setMemberJumpSignal] = useState(0);
  useEffect(() => {
    if (!memberJumpSignal) return;
    memberPanelRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [memberJumpSignal]);

  /* Deep-link to one member's tab.
   *
   * THE SCROLL IS THE FEATURE, not a nicety. These nudges sit at the top of the
   * home screen and the member panel they open is roughly two thousand pixels
   * below it, so selecting the member and setting the tab — which this always
   * did correctly — changed nothing whatsoever within sight of the person who
   * clicked. "No growth checks for Ganga yet" read as a dead button, and so did
   * every other nudge with a `tab` (sizes, check-ups, medical, documents) and
   * the whole ReadinessCard, while the nudges carrying a `view` worked, because
   * a view change scrolls to the top. Two rows of the same list, one live and
   * one apparently broken, with nothing on screen to explain the difference.
   *
   * setMainView('profiles') matters for the callers that are NOT on this screen
   * — the assistant bubble is mounted globally, so a member link tapped from
   * the calendar or the insurance view has to bring the profiles view with it.
   * One caller used to remember that itself; the other three did not. */
  const goToMemberTab = (memberId: string, tab: string) => {
    if (memberId === selectedMemberId) {
      setActiveTab(tab as TabId);
    } else {
      pendingTabRef.current = tab as TabId;
      setSelectedMemberId(memberId);
    }
    setMainView('profiles');
    setDeleteConfirmMemberId(null);
    // A counter, not a boolean: asking for the tab you are already on is still
    // a request to be taken there, and must still scroll.
    setMemberJumpSignal((n) => n + 1);
  };

  // Renewal notices across passports, permits, licenses and visas (real date)
  // --- Trips -------------------------------------------------------------
  //
  // A trip is a Travel calendar event with a return date (see utils/trip.ts) —
  // no second store, no sync. Everything below is derived from `events`, which
  // is already loaded, so this costs nothing on a family that never travels:
  // pulseTrips is empty and the banner does not render.
  const trips = useMemo(() => buildTrips(events), [events]);
  const pulseTrips = useMemo(() => currentTrips(trips), [trips]);

  // "Important — coming up" on both homes (Pulse and the classic one). Derived
  // from `events` like the trips above; booked referral visits follow the
  // calendar's own Medical checks switch, and a business space lists nothing
  // medical at all (utils/importantEvents.ts).
  const importantItems = useMemo(() => importantComingUp(events, members, todayIsoLocal(), {
    days: 30,
    business: isBusinessSpace,
    includeReferrals: settings.calendarDivisions?.medicalChecks !== false,
  }), [events, members, isBusinessSpace, settings.calendarDivisions?.medicalChecks]);

  // Who the signed-in account IS, as opposed to what it may do. Personalisation
  // only — see the boundary note in utils/me.ts. Never gate on this.
  const me = useMemo(
    () => resolveMe(members, accountUid, currentUser?.email).member,
    [members, accountUid, currentUser?.email],
  );

  const [openTripId, setOpenTripId] = useState<string | null>(null);
  const [tripFocusMemberId, setTripFocusMemberId] = useState<string | null>(null);
  // The vault is not loaded on the dashboard (it is a separate view, and the
  // documents list can be large), so the pack fetches it the first time a trip
  // is opened. A failure is survivable: the checklist still shows passports,
  // insurance details and the gaps — it just cannot show file links.
  const [tripVaultDocs, setTripVaultDocs] = useState<VaultDocument[]>([]);

  const openTripPack = useCallback((tripId: string, memberId?: string) => {
    setOpenTripId(tripId);
    setTripFocusMemberId(memberId || null);
    void loadDocuments().then((docs) => setTripVaultDocs(docs || [])).catch(() => setTripVaultDocs([]));
  }, []);

  // Attaching writes onto the Travel event itself, through the same save path
  // every other calendar change uses — so a trip's papers sync, export and
  // restore with the event, and there is no second thing to keep consistent.
  const handleAttachTripDoc = (docId: string, role: TripDocRole, memberId?: string) => {
    if (!openTripId) return;
    void handleSaveEvents(events.map((event) => {
      if (event.id !== openTripId) return event;
      const existing = event.tripDocs || [];
      // Attaching is the "bring it back" for a card removed with ✕ — an
      // explicit attach always wins over the hidden list, so clear the id.
      // Built without an explicit `tripDocsHidden: undefined` key: Firestore
      // rejects undefined field values.
      const next = { ...event };
      const hidden = (event.tripDocsHidden || []).filter((id) => id !== docId);
      if (hidden.length) next.tripDocsHidden = hidden; else delete next.tripDocsHidden;
      // Same document, same role, same person = already attached. Re-adding it
      // would render the row twice and make "Remove" ambiguous.
      if (!existing.some((ref) => ref.id === docId && ref.role === role && ref.memberId === memberId)) {
        next.tripDocs = [...existing, { id: docId, role, ...(memberId ? { memberId } : {}) }];
      }
      return next;
    }));
  };

  // "Remove from this travel pack" for an AUTO-PULLED card: nothing is
  // attached, so removal is recorded as a per-trip hidden id the checklist's
  // auto-pull skips. The file itself is untouched — that was the whole
  // complaint with delete-as-default.
  const handleHideTripDoc = (docId: string) => {
    if (!openTripId) return;
    void handleSaveEvents(events.map((event) => (
      event.id === openTripId && !(event.tripDocsHidden || []).includes(docId)
        ? { ...event, tripDocsHidden: [...(event.tripDocsHidden || []), docId] }
        : event
    )));
  };

  const handleDetachTripDoc = (docId: string, role: TripDocRole) => {
    if (!openTripId) return;
    void handleSaveEvents(events.map((event) => (
      event.id === openTripId
        ? { ...event, tripDocs: (event.tripDocs || []).filter((ref) => !(ref.id === docId && ref.role === role)) }
        : event
    )));
  };

  // Extract key facts for one attached vault document and persist them. The
  // fresh doc list from saveKeyFacts (post-merge truth, not our guess) becomes
  // the new tripVaultDocs so the glance card and the open viewer re-render
  // with the facts immediately.
  const handleExtractDocFacts = async (docId: string): Promise<{ ok: boolean; message?: string }> => {
    const doc = tripVaultDocs.find((d) => d.id === docId);
    if (!doc) return { ok: false, message: 'That document is no longer in the vault.' };
    if (keyFactsCurrent(doc)) return { ok: true };
    const res = await extractKeyFacts(vaultDocToReaderTarget(doc));
    if (res.kind !== 'result') return { ok: false, message: res.message };
    const next = await saveKeyFacts(docId, res.facts);
    if (!next) return { ok: false, message: 'Could not save the facts — please try again.' };
    setTripVaultDocs(next);
    return { ok: true };
  };

  // Upload a NEW file from the trip pack's picker (device file or clipboard
  // image): into the vault, then attached — or, when the bytes already exist
  // in the vault, attach the existing copy instead of duplicating it. The
  // pack decides the role (including the name-over-picker-scope redirect);
  // this host only moves the bytes and refreshes its copy of the vault.
  const handleUploadTripDoc = async (file: File, role: TripDocRole, memberId?: string): Promise<{ ok: boolean; message?: string; docId?: string; docName?: string; deduped?: boolean }> => {
    if (!openTripId) return { ok: false, message: 'The trip is no longer open.' };
    const res = await uploadTripDocFile(file, role, memberId);
    if (res.kind === 'error') return { ok: false, message: res.message };
    setTripVaultDocs(res.allDocs);
    handleAttachTripDoc(res.doc.id, role, memberId);
    return { ok: true, docId: res.doc.id, docName: res.doc.name, deduped: res.deduped };
  };

  // NOTE deliberately ABSENT: a per-card file delete in the trip pack
  // (v274/v275's handleDeleteTripDoc) — rejected twice by the owner. The pack
  // only ever removes trip-scoped links (detach/hide); files are deleted in
  // the Document Vault.

  // Re-filing is ONE save, not a detach followed by an attach: two sequential
  // handleSaveEvents calls would both map over the same stale `events` closure
  // and the second would silently undo the first.
  const handleMoveTripDoc = (docId: string, fromRole: TripDocRole, toRole: TripDocRole) => {
    if (!openTripId) return;
    void handleSaveEvents(events.map((event) => (
      event.id === openTripId
        ? { ...event, tripDocs: moveTripDoc(event.tripDocs || [], docId, fromRole, toRole) }
        : event
    )));
  };

  const openTrip = openTripId ? trips.find((trip) => trip.id === openTripId) || null : null;
  const openTripTravellers = openTrip
    ? (openTrip.memberIds.length ? members.filter((member) => openTrip.memberIds.includes(member.id)) : members)
    : [];

  const expiryWarnings = (() => {
    const today = new Date();
    const items: PulseExpiryWarning[] = [];
    const consider = (memberId: string, memberName: string, label: string, dateStr?: string, horizonMonths = 9) => {
      if (!dateStr) return;
      const expiry = new Date(dateStr);
      if (isNaN(expiry.getTime())) return;
      const diffTime = expiry.getTime() - today.getTime();
      const monthsLeft = Number((Math.ceil(diffTime / (1000 * 60 * 60 * 24)) / 30.4375).toFixed(1));
      if (diffTime < 0) items.push({ memberId, memberName, label, monthsLeft, status: 'expired' });
      else if (monthsLeft <= horizonMonths) items.push({ memberId, memberName, label, monthsLeft, status: 'critical' });
    };
    members.forEach(m => {
      consider(m.id, m.name, 'passport', m.passport?.expiryDate);
      (m.passports || []).forEach(p => consider(m.id, m.name, `${p.country || ''} passport`.trim(), p.expiryDate));
      consider(m.id, m.name, 'residence permit', m.identity?.residencePermitExpiry);
      consider(m.id, m.name, "driver's license", m.identity?.driversLicenseExpiry);
      (m.travel?.visas || []).forEach(v => consider(m.id, m.name, `${v.country || ''} visa`.trim(), v.expiryDate, 6));
    });
    return items;
  })();

  if (isAuthLoading || (!demo && currentUser && ctxLoading)) {
    return (
      <div className="min-h-screen bg-cream-100 flex items-center justify-center font-sans">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clay-500"></div>
      </div>
    );
  }

  if (!currentUser) {
    const joinLinkVisit = isJoinLinkVisit();
    return (
      <div
        className="min-h-screen bg-cream-100 flex items-center justify-center font-sans px-4"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 60% 50% at 12% -10%, rgba(253, 240, 234, 0.9), transparent 65%), radial-gradient(ellipse 60% 50% at 88% -10%, rgba(252, 244, 230, 0.9), transparent 65%)',
        }}
      >
        <div className="card p-10 text-center max-w-md w-full">
          {/* The sign-in screen is the one brand moment every single person sees —
              new users and everyone arriving on an invite link. It used to be a
              generic shield icon with the name set in the UI font; it now carries
              the actual mark and wordmark. Both are outlined SVG paths (no live
              text), so they need no webfont and render identically everywhere. */}
          <img
            src="/icons/app-icon.svg"
            alt=""
            width={56}
            height={56}
            className="mx-auto mb-4 rounded-[14px]"
          />
          <div className="mx-auto mb-4 inline-flex rounded-xl bg-ink-900 px-4 py-2.5">
            <img src="/icons/wordmark.svg" alt="Teluva" width={110} height={32} className="h-8 w-auto" />
          </div>
          <h1 className="text-display-md text-ink-900 mb-3">{joinLinkVisit ? "You've been invited" : hubName}</h1>
          <p className="text-sm text-ink-500 leading-relaxed mb-3">
            {joinLinkVisit
              ? 'Someone has invited you to join their private space on Teluva — one shared place for people, plans, documents and important records. Sign in with Google to accept and you\'ll land straight inside.'
              : 'Sizes, documents, growth and plans for the whole family — together in one private place.'}
          </p>
          {/* The multi-device story is a real differentiator and it was only ever
              written down in the pamphlet Rory sends separately — so anyone who
              gets a bare link forwarded to them never saw it. */}
          <p className="text-[12.5px] text-ink-400 leading-relaxed mb-8">
            Works right here in your browser — on your phone, tablet or computer. No app store, nothing to download first.
          </p>
          <button
            onClick={async () => {
              setSigningIn(true);
              setSignInError(null);
              const problem = await loginWithGoogle();
              setSignInError(problem);
              setSigningIn(false);
            }}
            disabled={signingIn}
            className="btn-primary w-full py-3 disabled:opacity-60"
          >
            {signingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            <span>{signingIn ? 'Signing in…' : 'Sign in with Google'}</span>
          </button>

          {/* The way out of "it just signs me back into the same account".
              Quiet by design — it sits under the primary button and only
              matters to the minority who need it — but visible and labelled
              rather than a hidden gesture, because the people who need it are
              precisely the ones who cannot get past this screen. */}
          <button
            type="button"
            onClick={async () => {
              setSigningIn(true);
              setSignInError(null);
              const problem = await loginWithGoogle({ chooseAccount: true });
              setSignInError(problem);
              setSigningIn(false);
            }}
            disabled={signingIn}
            className="mt-3 w-full text-[12.5px] text-ink-500 underline underline-offset-2 hover:text-ink-700 disabled:opacity-60 cursor-pointer"
          >
            Use a different Google account
          </button>

          {/* A failure used to be console-only, so the button just did nothing. */}
          {signInError && (
            <p role="alert" className="mt-3 rounded-2xl border border-rosa-200 bg-rosa-50 px-3 py-2 text-left text-[12.5px] text-rosa-700">
              {signInError}
            </p>
          )}
          {/* Google's "hasn't verified this app" screen genuinely frightens
              people, and until now the only place we explained it was an
              external pamphlet. Honest framing only (design-audit P0): the
              warning is real — Google has not reviewed this app yet — so we
              explain WHY it appears and who should proceed, and never walk
              people through the bypass taps or tell them a security warning
              "is safe". Kept collapsed so it doesn't compete with the button —
              and a plain <details> so it needs no state and works before
              hydration. */}
          <details className="group mt-4 text-left">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] text-ink-400 transition-colors hover:text-ink-600">
              <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
              What you&rsquo;ll see next
            </summary>
            <div className="mt-2 space-y-2 rounded-2xl bg-cream-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-500">
              <p>
                Google may show a screen saying &ldquo;Google hasn&rsquo;t verified this app.&rdquo; That warning is genuine:
                Teluva hasn&rsquo;t completed Google&rsquo;s app-verification review yet, so Google can&rsquo;t vouch for it and
                says so. Verification is in progress; until it&rsquo;s done, only continue past that screen if you were
                personally invited by someone you know and trust who runs this space.
              </p>
              <p>
                If sign-in fails outright instead, send Rory the Gmail address you&rsquo;re using and he&rsquo;ll add you — it takes
                two minutes.
              </p>
            </div>
          </details>
          <a href="?demo=1" className="inline-block mt-5 text-xs text-ink-400 underline underline-offset-2 hover:text-ink-600">
            or take a peek at the demo
          </a>
          <div className="mt-6 pt-4 border-t border-cream-200 text-left text-[12px] leading-relaxed text-ink-400">
            {/* The honest security position belongs at the point of decision,
                not only on a page you reach after already signing in. Kept to
                one short sentence — any longer and this grey block outweighs
                the button above it. */}
            Encrypted in transit and at rest, and {joinLinkVisit ? 'the invited space stays separate from every other Teluva space' : 'your family’s vault stays separate from every other family’s'} —{' '}
            <button onClick={() => setLegalTab('security')} className="underline underline-offset-2 hover:text-ink-600 cursor-pointer">how we keep it safe</button>.
            {' '}By signing in you agree to our{' '}
            <button onClick={() => setLegalTab('terms')} className="underline underline-offset-2 hover:text-ink-600 cursor-pointer">Terms</button>
            {' '}and{' '}
            {/* The full stop is glued to the link: as two separate inline nodes
                it wrapped onto a line of its own at 375px. */}
            <span className="whitespace-nowrap">
              <button onClick={() => setLegalTab('privacy')} className="underline underline-offset-2 hover:text-ink-600 cursor-pointer">Privacy Policy</button>.
            </span>
          </div>
        </div>
      {legalTab && <LegalModal tab={legalTab} onClose={() => setLegalTab(null)} />}
      </div>
    );
  }

  /* Its own button, deliberately outside the space-switcher trigger: tapping a
     family photo should show the family photo. Bigger than the old 36px too —
     it is the one personal thing in the header and it was the size of an icon. */
  const hubAvatar = settings.familyPhotoUrl ? (
    <button
      type="button"
      onClick={() => setLightboxImage(settings.familyPhotoUrl!)}
      title={isBusinessSpace ? 'View business photo' : 'View family photo'}
      aria-label={isBusinessSpace ? 'View business photo' : 'View family photo'}
      className="w-12 h-12 rounded-2xl overflow-hidden shrink-0 border border-cream-300 shadow-soft cursor-zoom-in transition-transform hover:scale-105"
    >
      <img src={settings.familyPhotoUrl} alt={isBusinessSpace ? 'Business' : 'Family'} className="w-full h-full object-cover" />
    </button>
  ) : (
    <button
      type="button"
      onClick={() => !demo && setIsSettingsOpen(true)}
      title={demo ? undefined : isBusinessSpace ? 'Add a business photo' : 'Add a family photo'}
      aria-label={demo ? (isBusinessSpace ? 'Business' : 'Family') : isBusinessSpace ? 'Add a business photo' : 'Add a family photo'}
      className={`w-12 h-12 rounded-2xl bg-sage-100 flex items-center justify-center shrink-0 transition-colors ${demo ? '' : 'hover:bg-sage-200 cursor-pointer'}`}
    >
      <ShieldCheck className="w-6 h-6 text-sage-600" />
    </button>
  );

  /* The account actions, as menu rows rather than a permanent row of six
     unlabelled icons in the header. Export, restore, leave and sign out are
     once-a-year controls that were holding prime real estate; naming them also
     fixes the guessing game of what each icon did. */
  const menuRow = 'w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-semibold text-ink-700 hover:bg-cream-100 transition-colors cursor-pointer';
  const accountMenuItems = !demo ? (
    <>
      <button type="button" onClick={() => setIsSettingsOpen(true)} className={menuRow}>
        <Settings className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left">{isBusinessSpace ? 'Business settings' : 'Hub settings'}</span>
      </button>

      {familySettingsButton}

      {/* stopPropagation: SpaceSwitcher closes the menu on any click in this
          footer, which is right for "download a backup" and wrong for these —
          you pick a palette by looking at it, and with the phone's floating
          Appearance pill gone this menu is the only way in. Changing a swatch
          must not slam the door on the next one. */}
      <div className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-400">Appearance</p>
        <AppearanceControls compact />
      </div>

      <button type="button" onClick={handleExportAllData} disabled={exportingBackup} className={`${menuRow} disabled:opacity-50`}>
        {exportingBackup ? <Loader2 className="w-4 h-4 shrink-0 animate-spin" /> : <Download className="w-4 h-4 shrink-0" />}
        <span className="flex-1 text-left">{exportingBackup ? 'Preparing backup…' : 'Download a backup'}</span>
      </button>

      <label className={menuRow}>
        <Upload className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left">Restore from a backup</span>
        <input type="file" accept=".zip,.json,application/zip,application/json" onChange={handleImportAllData} className="hidden" />
      </label>

      {/* Above the divider deliberately: the rows below it leave the family or
          the session, and "tell us what's broken" must never sit a mis-tap
          away from "Leave this family". */}
      <button type="button" onClick={() => setIsFeedbackOpen(true)} className={menuRow}>
        <MessageSquare className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left">Send feedback</span>
      </button>

      <div className="my-1.5 border-t border-cream-200" />

      <button type="button" onClick={handleLeaveFamily} className={`${menuRow} text-rosa-600 hover:bg-rosa-50`}>
        <UserMinus className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left">{isBusinessSpace ? 'Leave this business' : 'Leave this family'}</span>
      </button>

      <button type="button" onClick={logout} className={menuRow}>
        <LogOut className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left">Sign out</span>
      </button>
    </>
  ) : null;

  const availableViewItems = VIEWS
    // Insurance is hidden alongside Finances for child accounts: its data
    // lives IN the finances document, which firestore.rules now denies to
    // children outright (role matrix, 2026-08-24) — showing the section
    // would render an empty view.
    .filter(view => !((view.id === 'finances' || view.id === 'insurance') && !canWrite) && !(view.id === 'passwords' && !isAdmin))
    // Same reasoning, business-space edition (v333): firestore.rules now
    // refuses reference/finances to any non-admin in a business space — the
    // adults-only rule was written for a household where every adult
    // genuinely shares the bank accounts, and in a business the identical
    // words meant every employee could read the company's IBANs. Hiding the
    // tab keeps the UI honest about what the rule already refuses instead of
    // sending an employee to an empty screen (loadReferenceDoc purges to
    // null on permission-denied — see db.ts — so nothing crashes, it just
    // looks broken).
    .filter(view => !((view.id === 'finances' || view.id === 'insurance') && isBusinessSpace && !isAdmin))
    .filter(view => !(view.id === 'willsEstate' && !mayReadWills))
    .filter(view => !(isBusinessSpace && HIDDEN_VIEWS_IN_BUSINESS.includes(view.id)))
    .map(view => ({ id: view.id, icon: view.icon, label: viewLabel(view.id, t, isBusinessSpace) }));

  const visibleProfileTabs = selectedMember ? TABS.filter(tab =>
    (tab.id !== 'growth' || selectedMember.role === 'Child')
    && !(tab.id === 'secrets' && !isAdmin)
    && !(isBusinessSpace && HIDDEN_IN_BUSINESS.includes(tab.id))
    && !(!isBusinessSpace && HIDDEN_IN_FAMILY.includes(tab.id))
  ) : [];
  const activeProfileLens = profileLensFor(activeTab);
  const emergencyFocus = emberInterface && mainView === 'emergency';

  return (
    /* Whose dates this account has chosen not to see. A family-only idea —
       business spaces get no provider, so every filter below is a no-op there
       and no Hide action is drawn (the birthday, anniversary and pet views
       are hidden in business spaces anyway). */
    <HiddenPeopleProvider
      enabled={!isBusinessSpace && (demo || !!accountUid)}
      readOnly={demo}
      // The demo has no account; it plays Mama's so "Choose who" can say
      // "(you)" on one row. readOnly keeps it from loading or saving anything.
      uid={accountUid || (demo ? DEMO_ACCOUNT_UID : null)}
      spaceId={activeSpaceId || null}
      // The demo shows every choice as an owner would see them; readOnly
      // already stops it saving any.
      canHideForFamily={canWrite || demo}
      familyList={settings.hiddenDatePeople}
      saveFamilyList={saveFamilyHiddenDates}
      // "Choose who" — hide someone from chosen accounts, other admins
      // included. Offered to admins; a policy the app keeps, not a rules
      // boundary (any settings writer could write the key).
      canHideForSome={isAdmin || demo}
      forList={settings.hiddenDatePeopleFor}
      saveForList={saveHiddenDatesFor}
      saveSettingsLists={saveHiddenDateLists}
      loadAccounts={loadHideAccounts}
      members={members}
      extendedBirthdays={homeExtendedBirthdays}
    >
    <div className={`min-h-screen bg-cream-100 text-ink-900 pb-12 font-sans ${emberInterface ? 'ember-app' : ''} ${emergencyFocus ? 'ember-emergency-mode' : ''}`}>
      {emberInterface && !emergencyFocus && (
        <EmberNavigation
          current={mainView}
          onSelect={(destination: EmberDestination) => setMainView(destination as ViewId)}
          onAsk={() => setAssistantOpenSignal((n) => n + 1)}
          onCapture={() => setIsCaptureOpen(true)}
          onSettings={() => setIsSettingsOpen(true)}
          isBusinessSpace={isBusinessSpace}
        />
      )}
      {/* Header */}
      {/* Ember Thread: the top bar is a deliberately FIXED dark surface, not a
          themed one — it does not flip with light/dark mode. Same "black
          card" move as StepHeader's v224 redesign, now the app's one
          constant landmark instead of a surface that blends into whichever
          theme is active. Everything inside therefore uses literal dark-
          surface colours rather than the cream/ink tokens (which invert
          under dark mode and would fight this bar's own fixed intent). */}
      {!emergencyFocus && <header className={`bg-[#0b0b0d] backdrop-blur border-b border-white/10 sticky top-0 z-40 ${emberInterface ? 'ember-header' : ''}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
          {/* One control, not seven. The hub name IS the menu: spaces, settings,
              backup and sign-out all live behind it, the way a workspace name
              works in Slack or Notion. Everything here used to be laid out
              across the header as a title, a space pill repeating that same
              title, and a permanent row of five unlabelled icon buttons. */}
          <div className="flex items-center gap-3 min-w-0">
            {hubAvatar}
            {demo ? (
              <h1 className="font-display text-lg font-semibold text-white leading-tight truncate">{hubName}</h1>
            ) : (
              <SpaceSwitcher
                spaces={spaces}
                activeId={activeSpaceId}
                canCreate={canWrite}
                onSwitch={handleSwitchSpace}
                onCreate={handleCreateSpace}
                onJoin={handleJoinSpace}
                title={hubName}
                footer={accountMenuItems}
              />
            )}
          </div>

          {/* The way out of the demo. There is one in the footer too, but the
              footer is a long scroll down from here and an installed app has no
              address bar to escape with — so on the laptop it read as an app
              with nowhere to sign in. It takes the slot the space switcher
              would occupy, which is empty in demo mode anyway. */}
          {demo && (
            <a href="/" className="btn-primary shrink-0 px-3 py-1.5 text-[13px] no-underline">
              Sign in
            </a>
          )}

          {/* Main view switcher — a burger dropdown so all sections are reachable
              in one tap, no horizontal sliding. */}
          {/* data-tour anchor wraps the trigger only ("contents" keeps it
              layout-transparent) — FirstRunTour spotlights the closed burger
              button itself, it doesn't need to open the menu. */}
          <div data-tour="section-menu" className="contents">
            <SectionMenu
              views={availableViewItems}
              current={mainView}
              onSelect={(id) => setMainView(id as ViewId)}
            />
          </div>

          {/* Only what changes how you read the screen stays out here: a
              reminder that you can't edit, if you can't. */}
          <div className="flex items-center gap-2">
            {role === 'child' && (
              <span className="text-xs bg-sage-100 text-sage-700 rounded-full px-2 py-0.5 font-semibold">View only</span>
            )}
            {role === 'member' && (
              <span className="text-xs bg-sage-100 text-sage-700 rounded-full px-2 py-0.5 font-semibold">Member</span>
            )}
          </div>
        </div>
      </header>}

      <main
        className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6 ${emberInterface ? 'ember-main' : ''} ${emergencyFocus ? 'ember-emergency-main' : ''}`}
        data-view={emberInterface ? mainView : undefined}
      >
        {emberInterface && mainView !== 'pulse' && !emergencyFocus && (
          <EmberViewHeader
            current={mainView === 'profiles' && peoplePane === 'todo' ? 'profilesTodo' : mainView}
            views={availableViewItems}
            onSelect={(id) => setMainView(id as ViewId)}
            isBusinessSpace={isBusinessSpace}
          />
        )}
        {/* Quiet, not a banner: start-up couldn't bring Google Calendar in
            without asking (see the start-up import effect), so say how stale
            it is and offer the one button that may ask. Only on the screens
            where appointments are looked for. */}
        {googleSyncNote && (mainView === 'pulse' || mainView === 'profiles' || mainView === 'calendar') && (
          <p className="text-[12px] text-ink-500 flex flex-wrap items-center gap-x-1.5" role="status">
            <span>{googleSyncNote} —</span>
            <button
              type="button"
              onClick={() => void handleGoogleRefresh()}
              disabled={googleRefreshing}
              className="font-semibold text-clay-600 hover:text-clay-700 underline underline-offset-2 disabled:opacity-50"
            >
              {googleRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </p>
        )}
        {/* Suspense wraps every lazy-loaded mainView branch below — see the
            React.lazy declarations near the top of this file for why. It also
            wraps 'profiles' further down, harmlessly: nothing inside that
            branch is lazy, so it can never actually suspend. */}
        <Suspense fallback={<ViewLoading />}>
        {mainView === 'calendar' && (
          <FamilyCalendar
            members={members}
            events={events}
            emberMode={emberInterface}
            openAddSignal={capturePlanSignal}
            isBusinessSpace={isBusinessSpace}
            onSaveEvents={handleSaveEvents}
            meMemberId={me?.id}
            // Per-division show/hide for the nine "at a glance" panels
            // (HubSettings.calendarDivisions) — same shared settings doc as
            // every toggle on this screen; FamilySettings writes it, this
            // is just the read side.
            settings={settings}
            // Opt-in outbound Google Calendar sync — persisted on the shared
            // HubSettings doc (same store as astrology/celebrations toggles)
            // so it's remembered across devices/reloads, not a per-tab
            // preference. Default off: settings.autoSyncEventsToGoogle is
            // undefined until someone explicitly flips the switch in the
            // Sync Panel, and handleSaveSettings below persists it the same
            // way every other Hub setting is saved. This component only
            // owns the toggle's on/off UI; the actual push happens in the
            // auto-sync effect further down this file (search
            // "AUTOMATIC OUTBOUND SYNC"), because that effect must keep
            // running even while the user isn't on the Calendar tab.
            // Subscribed external calendars, on the same shared HubSettings doc
            // as every other cross-device setting, so a subscription added on
            // one phone is live on the others.
            calendarFeeds={settings.calendarFeeds || []}
            onSaveCalendarFeeds={(feeds) => handleSaveSettings({ ...settings, calendarFeeds: feeds })}
            autoSyncEnabled={!!settings.autoSyncEventsToGoogle}
            onToggleAutoSync={(enabled) => {
              // Turning it ON captures a snapshot of every event id that
              // exists RIGHT NOW as the "history" boundary — see
              // HubSettings.autoSyncBaselineIds in types.ts for the full
              // reasoning. This is the one and only place that boundary is
              // ever written, and it always overwrites whatever was there
              // before: re-enabling after a period of being off must not
              // resurrect the OLD boundary (which could otherwise make
              // something created while it was off look like "history" and
              // get silently skipped) — the current live event list is
              // always the correct new boundary at the moment of opt-in.
              // Turning it off leaves the stored boundary untouched; it's
              // simply not consulted while the toggle is off, and gets
              // replaced outright the next time it's turned back on.
              const next: HubSettings = enabled
                ? { ...settings, autoSyncEventsToGoogle: true, autoSyncBaselineIds: events.map(e => e.id) }
                : { ...settings, autoSyncEventsToGoogle: false };
              void handleSaveSettings(next);
            }}
          />
        )}

        {/* onContactsChange is skipped in the demo: ImportantInfo reads the real
            (empty) vault on mount and would push [] up, wiping the demo family's
            contacts — and with them Oma's birthday off the home screen the
            moment you looked at the Info tab. */}
        {mainView === 'info' && <ImportantInfo refreshKey={aiDataVersion} isBusinessSpace={isBusinessSpace} country={settings.country || 'AT'} onContactsChange={demo ? undefined : setContacts} />}

        {mainView === 'emergency' && <EmergencyView members={members} country={settings.country || 'AT'} emberMode={emberInterface} packScope={emergencyPackScope} trips={pulseTrips} onOpenTrip={openTripPack} onExit={emberInterface ? () => setMainView('profiles') : undefined} />}

        {mainView === 'household' && <HouseholdView refreshKey={aiDataVersion} isBusinessSpace={isBusinessSpace} country={settings.country || 'AT'} openAddSignal={captureHouseSignal} emberMode={emberInterface} demo={demo} />}

        {mainView === 'finances' && <FinancesView refreshKey={aiDataVersion} isBusinessSpace={isBusinessSpace} onOpenPrivacy={() => setLegalTab('privacy')} />}
        {mainView === 'insurance' && <InsuranceView members={members} canUseAI={canUseAI} isBusinessSpace={isBusinessSpace} />}
        {mainView === 'familyWords' && <FamilyWordsView members={members} canEdit={demo || canWrite} demo={demo} refreshKey={aiDataVersion} />}
        {mainView === 'vehicles' && <VehiclesView members={members} canEdit={demo || canWrite} demo={demo} refreshKey={aiDataVersion} canUseAI={canUseAI} isBusinessSpace={isBusinessSpace} />}
        {mainView === 'pets' && <PetsView refreshKey={aiDataVersion} />}
        {mainView === 'familyTree' && (
          <FamilyTreeView
            refreshKey={aiDataVersion}
            canAddChild={!demo && isAdmin}
            onAddChild={() => { setAddMemberInitialRole('Child'); setAddingChildFromTree(true); setIsAddModalOpen(true); }}
            newChildId={newTreeChildId}
            onNewChildHandled={() => setNewTreeChildId(null)}
          />
        )}

        {mainView === 'timeline' && (
          <TimelineView
            key={aiDataVersion}
            openAddSignal={captureStorySignal}
            emberMode={emberInterface}
            members={members}
            events={events}
            isBusinessSpace={isBusinessSpace}
            canEdit={demo || canWrite}
            demo={demo}
            onOpenMemberTab={goToMemberTab}
            onOpenHealth={(id) => { setHealthTimelineMemberId(id); setShowHealthTimeline(true); }}
            onOpenView={(view) => setMainView(view)}
          />
        )}

        {mainView === 'travelTimeline' && (
          demo ? <DemoUnavailable label="The travel timeline" isBusinessSpace={isBusinessSpace} /> : <TravelTimelineView key={aiDataVersion} />
        )}

        {mainView === 'vault' && (
          // onMembersChange lets a vault delete also strip the per-member copy
          // of the same document — the vault component has no other way to
          // persist member records (Dashboard owns that write).
          demo ? <DemoUnavailable label="The document vault" isBusinessSpace={isBusinessSpace} /> : <DocumentVault members={members} isBusinessSpace={isBusinessSpace} onMembersChange={persistChanges} emberMode={emberInterface} openUploadSignal={captureVaultSignal} incomingFile={sharedFile} onIncomingConsumed={() => setSharedFile(null)} />
        )}

        {mainView === 'shopping' && (
          demo ? <DemoUnavailable label="The shopping list" isBusinessSpace={isBusinessSpace} /> : <ShoppingList key={aiDataVersion} />
        )}

        {mainView === 'gifts' && (
          <GiftsOccasionsView
            members={members}
            onSelectMember={(id) => goToMemberTab(id, 'favorites')}
          />
        )}

        {mainView === 'chat' && (
          demo ? (
            <DemoUnavailable label={isBusinessSpace ? 'Team chat' : 'Family chat'} isBusinessSpace={isBusinessSpace} />
          ) : (
            <FamilyChat members={members} selectedMemberId={selectedMemberId} isBusinessSpace={isBusinessSpace} />
          )
        )}

        {mainView === 'drive' && (
          demo ? <DemoUnavailable label="Drive sync" isBusinessSpace={isBusinessSpace} /> : <GoogleDriveSync />
        )}

        {mainView === 'assets' && (
          demo ? <DemoUnavailable label={isBusinessSpace ? 'Business assets' : 'Family assets'} isBusinessSpace={isBusinessSpace} /> : <Assets key={aiDataVersion} />
        )}

        {mainView === 'recipes' && (
          demo ? <DemoUnavailable label="The recipe book" isBusinessSpace={isBusinessSpace} /> : <RecipeBook key={aiDataVersion} />
        )}

        {mainView === 'anniversaries' && (
          demo ? <DemoUnavailable label="Anniversaries & special days" isBusinessSpace={isBusinessSpace} /> : <AnniversariesView key={aiDataVersion} members={members} />
        )}

        {mainView === 'extendedBirthdays' && (
          demo ? <DemoUnavailable label="Extended birthdays" isBusinessSpace={isBusinessSpace} /> : <ExtendedBirthdaysView key={aiDataVersion} onChange={setExtendedBirthdayRecords} />
        )}

        {mainView === 'inMemory' && (
          demo ? <DemoUnavailable label="In Memory" isBusinessSpace={isBusinessSpace} /> : <InMemoryView key={aiDataVersion} emberMode={emberInterface} />
        )}

        {mainView === 'willsEstate' && (
          demo ? <DemoUnavailable label="Wills & estate" isBusinessSpace={isBusinessSpace} /> : <WillsEstateView refreshKey={aiDataVersion} members={members} hubName={hubName} />
        )}

        {mainView === 'slips' && (
          demo ? <DemoUnavailable label="Purchase slips" isBusinessSpace={isBusinessSpace} /> : <SlipsView key={aiDataVersion} isBusinessSpace={isBusinessSpace} />
        )}

        {mainView === 'passwords' && (
          demo ? <DemoUnavailable label={isBusinessSpace ? 'Business passwords' : 'Family passwords'} isBusinessSpace={isBusinessSpace} /> : <FamilyPasswords isBusinessSpace={isBusinessSpace} />
        )}

        {mainView === 'pulse' && (
          <FamilyPulse
            members={members}
            events={events}
            status={settings.status}
            familyPhotoUrl={settings.familyPhotoUrl}
            onViewPhoto={(url) => setLightboxImage(url)}
            expiryWarnings={expiryWarnings}
            onOpenCalendar={() => setMainView('calendar')}
            onOpenMemberIds={(memberId) => goToMemberTab(memberId, 'ids')}
            onOpenPeople={() => setMainView('profiles')}
            isBusinessSpace={isBusinessSpace}
            trips={pulseTrips}
            me={me}
            onOpenTrip={openTripPack}
            importantItems={importantItems}
          />
        )}

        {mainView === 'profiles' && (
          <>
            {/* Only ever asks once the family has actually put something in —
                an install prompt over an empty vault is asking for commitment
                before showing any value. Silent in demo mode. */}
            {!demo && <InstallPrompt hasContent={members.length > 0} />}

            {emberInterface && (
              <nav className="card flex items-center gap-1 p-1.5" aria-label={isBusinessSpace ? 'Team sections' : 'People sections'}>
                <button
                  type="button"
                  onClick={() => setPeoplePane('profiles')}
                  aria-current={peoplePane === 'profiles' ? 'page' : undefined}
                  className={`flex-1 rounded-xl px-4 py-2.5 text-[13px] font-bold transition-colors ${peoplePane === 'profiles' ? 'bg-ink-900 text-white' : 'text-ink-500 hover:bg-cream-100'}`}
                >
                  {isBusinessSpace ? 'Team profiles' : 'Family profiles'}
                </button>
                <button
                  type="button"
                  onClick={() => setPeoplePane('todo')}
                  aria-current={peoplePane === 'todo' ? 'page' : undefined}
                  className={`flex-1 rounded-xl px-4 py-2.5 text-[13px] font-bold transition-colors ${peoplePane === 'todo' ? 'bg-ink-900 text-white' : 'text-ink-500 hover:bg-cream-100'}`}
                >
                  To-do &amp; readiness
                </button>
              </nav>
            )}

            {(!emberInterface || peoplePane === 'todo') && (
              <>

            {pendingEditCount > 0 && (
              <button
                type="button"
                onClick={() => setAssistantOpenSignal((n) => n + 1)}
                className="card flex w-full items-center gap-2.5 border-clay-200 bg-clay-50/70 p-3 text-left transition-colors hover:bg-clay-50 cursor-pointer"
              >
                <Wand2 className="w-4 h-4 shrink-0 text-clay-600" />
                <span className="flex-1 text-[13px] text-ink-800">
                  <b className="font-semibold">
                    {pendingEditCount} {pendingEditCount === 1 ? 'change' : 'changes'}
                  </b>{' '}
                  from the assistant {pendingEditCount === 1 ? 'is' : 'are'} waiting to be saved
                </span>
                <span className="shrink-0 text-[13px] font-semibold text-clay-700">Review</span>
              </button>
            )}

            {/* Family-only: scores willsEstate/emergency-style readiness, which
                has no business-space equivalent (willsEstate itself is hidden
                in business spaces — see HIDDEN_VIEWS_IN_BUSINESS). */}
            {!isBusinessSpace && (
              <ReadinessCard
                members={members}
                familyId={activeSpaceId}
                demo={demo}
                onGo={goToMemberTab}
                onGoView={(v) => setMainView(v as ViewId)}
              />
            )}

            {/* Pulse carries its own copy of this card; the classic home gets
                it here, above what needs doing, as the thing to see first. */}
            {!emberInterface && (
              <ImportantComingUp variant="classic" items={importantItems} members={members} onOpenCalendar={() => setMainView('calendar')} />
            )}

            <NeedsAttention members={members} extendedBirthdays={homeExtendedBirthdays} onGo={goToMemberTab} onGoView={(v) => setMainView(v as ViewId)} />

            {/* BELOW Needs attention, never above it. One card is what you must
                do and the other is what already happened; a trail that pushed
                an expiring passport under the fold would be a feed competing
                with the thing the app is for. Not shown in the demo, where
                nothing anybody did is real. */}
            {!demo && <RecentActivity />}
              </>
            )}
            <CelebrationOverlay members={members} />

            {(!emberInterface || peoplePane === 'profiles') && (
              <>
            {initialLoadDone && members.length === 0 ? (
              <div className="card text-center py-20 px-6">
                <div className="w-16 h-16 rounded-2xl bg-clay-50 text-clay-600 flex items-center justify-center mx-auto mb-5">
                  <Users className="w-8 h-8" />
                </div>
                <h2 className="text-display-sm text-ink-900 mb-2">Welcome to {hubName}</h2>
                <p className="text-sm text-ink-500 max-w-md mx-auto mb-7">
                  {isBusinessSpace
                    ? 'Keep your team, vehicles, leases, insurance and documents in one tidy, private place.'
                    : "Keep everyone's clothing sizes, documents, growth history and wish lists in one tidy, private place."}
                </p>
                {isAdmin && (
                  <button data-tour="add-first-member" onClick={() => setIsAddModalOpen(true)} className="btn-primary">
                    <UserPlus className="w-4 h-4" />
                    <span>{isBusinessSpace ? 'Add your first team member' : 'Add your first family member'}</span>
                  </button>
                )}
              </div>
            ) : (
              <div className={`grid grid-cols-1 lg:grid-cols-12 gap-6 items-start ${emberInterface ? 'ember-people-layout' : ''}`}>
                {/* Family directory */}
                <section className={`lg:col-span-4 space-y-5 ${emberInterface ? 'ember-people-directory' : ''}`}>

                  <div data-tour="family-list" className="card p-5 space-y-4">
                    {/* An employee in a business space sees only their own
                        record — firestore.rules treats a colleague's as an HR
                        file. Said out loud, because a team list containing one
                        person otherwise reads as a broken app or an empty
                        company, and the person most likely to conclude that is
                        a new employee on their first day. */}
                    {isBusinessSpace && !isAdmin && (
                      <div className="rounded-xl border border-cream-200 bg-cream-50 p-3 flex items-start gap-2">
                        <Lock className="w-4 h-4 text-ink-400 mt-0.5 shrink-0" />
                        <p className="text-[12px] text-ink-600 leading-relaxed">
                          You can see your own record here. Colleagues&rsquo; records hold things like
                          medical details and home addresses, so they stay between each person and an
                          owner of this space &mdash; nothing is missing or broken.
                        </p>
                      </div>
                    )}

                    {/* …and then the answer, rather than only the apology. The
                        directory is the small question — who works here, how
                        do I reach them at work — answered by the server from
                        an allowlist (server/directory.mjs), because rules gate
                        documents and this needs a field boundary. */}
                    {isBusinessSpace && !isAdmin && <TeamDirectory selfMemberId={me?.id} />}

                    <div className="flex items-center justify-between pb-3.5 border-b border-cream-200">
                      <h4 className="section-label flex-1">{isBusinessSpace ? 'Your team' : 'Your family'}</h4>
                      {/* Adding a person belongs beside the list of people, not
                          in the app header where it used to sit. */}
                      {isAdmin && (
                        <button
                          data-tour="add-first-member"
                          type="button"
                          onClick={() => setIsAddModalOpen(true)}
                          title={t.btn_add}
                          aria-label={isBusinessSpace ? "Add team member" : "Add family member"}
                          className="mr-2 flex items-center justify-center w-11 h-11 rounded-full bg-clay-500 text-white transition-colors hover:bg-clay-600 cursor-pointer"
                        >
                          <UserPlus className="w-4 h-4" />
                        </button>
                      )}
                      {/* Below four people the list is short enough that a
                          collapse control is just another thing to read. */}
                      {members.length >= 4 ? (
                        <button
                          type="button"
                          onClick={toggleListCollapsed}
                          aria-expanded={!listCollapsed}
                          title={listCollapsed ? 'Show everyone' : 'Collapse the list'}
                          className="chip flex items-center gap-1 bg-cream-200 text-ink-600 tabular-nums transition-colors hover:bg-cream-300 cursor-pointer"
                        >
                          <span>{members.length} member{members.length !== 1 ? 's' : ''}</span>
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${listCollapsed ? '-rotate-90' : ''}`} />
                        </button>
                      ) : (
                        <span className="chip bg-cream-200 text-ink-600 tabular-nums">
                          {members.length} member{members.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>

                    {listCollapsed && members.length >= 4 ? (
                      /* Collapsed: the person you are actually looking at, and a
                         way back to everyone else. Reordering is a whole-list
                         action, so it belongs to the expanded state only. */
                      <div className="space-y-2.5">
                        {selectedMember && (
                          <div className={cardClass(selectedMember)}>
                            {memberCardInner(selectedMember)}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={toggleListCollapsed}
                          className="btn-quiet w-full justify-center text-[13px]"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                          <span>Show all {members.length}</span>
                        </button>
                      </div>
                    ) : (
                      <Reorder.Group axis="y" values={members} onReorder={handleReorder} className="space-y-2.5">
                        {members.map((member) => (
                          <DraggableRow
                            key={member.id}
                            member={member}
                            className={`${cardClass(member)} cursor-pointer`}
                            onSelect={() => { setSelectedMemberId(member.id); setSharedView(null); setHouseholdView(null); setDeleteConfirmMemberId(null); }}
                            onDragEnd={saveOrder}
                            renderInner={memberCardInner}
                          />
                        ))}
                      </Reorder.Group>
                    )}

                    {/* Cousins, nieces and nephews — the other half of "who is
                        family", and Rory's own placement: "the extended family
                        should be at the bottom of the profile pack". Third
                        position in three versions, so the history matters. As a
                        SIBLING of this card it picked up the directory's sticky
                        rule and covered the list; moved above the list and
                        un-stuck it scrolled out of reach; at the top of the card
                        it read as though the cousins outranked the family. Here
                        it is under the people, still INSIDE the card that pins,
                        so it travels with the list rather than away from it.
                        Deliberately visible to children, who are the ones who
                        want to see their cousins. */}
                    <ConnectedInline
                      onManage={() => setConnectedOpen(true)}
                      members={members}
                      openPersonId={sharedView?.member.id || null}
                      openHouseholdId={householdView?.link.id || null}
                      onOpenPerson={(m, household, linkId) => {
                        setSharedView({ member: m, household, linkId });
                        setHouseholdView(null);
                        setDeleteConfirmMemberId(null);
                        // Same move the member rows make, so the panel is on
                        // screen on a phone where it sits below the list.
                        memberPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      onOpenHousehold={(payload) => {
                        setHouseholdView(payload);
                        setSharedView(null);
                        setSelectedMemberId('');
                        setDeleteConfirmMemberId(null);
                        memberPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                    />
                  </div>

                </section>

                {/* Selected member detail */}
                <section ref={memberPanelRef} className={`lg:col-span-8 space-y-5 scroll-mt-24 ${emberInterface ? 'ember-living-profile' : ''}`}>
                  {householdView ? (
                    <SharedHousehold
                      householdName={householdView.link.otherName || 'Connected family'}
                      photoUrl={householdView.photoUrl}
                      members={householdView.members}
                      linkId={householdView.link.id}
                      sharedByMeCount={householdView.link.sharedByMe.length}
                      connectedAt={householdView.link.connectedAt}
                      namedByThem={householdView.namedByThem}
                      memberName={(id) => members.find((m) => m.id === id)?.name || 'someone in your family'}
                      onOpenPerson={(m) => {
                        setSharedView({ member: m, household: householdView.link.otherName || 'Connected family', linkId: householdView.link.id });
                        setHouseholdView(null);
                      }}
                      onClose={() => setHouseholdView(null)}
                      onViewPhoto={(url) => setLightboxImage(url)}
                    />
                  ) : sharedView ? (
                    <SharedProfile
                      member={sharedView.member}
                      householdName={sharedView.household}
                      linkId={sharedView.linkId}
                      onClose={() => setSharedView(null)}
                      onViewPhoto={(url) => setLightboxImage(url)}
                    />
                  ) : selectedMember ? (
                    <div className="card overflow-hidden min-h-[500px] flex flex-col">
                      <div className={`p-5 sm:p-6 border-b border-cream-200 flex flex-col gap-5 ${emberInterface ? 'ember-profile-hero' : 'xl:flex-row xl:items-center justify-between gap-4'}`}>
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="relative shrink-0">
                            {selectedMember.avatarUrl ? (
                              <div className="avatar-ring">
                                {/* ONE PRESS. Rory: "i dont want to have to
                                    press twice if i press on the image it must
                                    open up the photo if i press on the icon it
                                    must open the pickers". Routing an admin's
                                    tap into the menu made the most obvious
                                    gesture on the screen — tap the face, see
                                    the face — cost two presses, which is the
                                    lightbox bug in a different shape. The
                                    picture is the picture; the badge is the
                                    options. Same for everyone, admin or not. */}
                                <button
                                  type="button"
                                  onClick={() => setLightboxImage(selectedMember.avatarUrl!)}
                                  className="block w-24 h-24 lg:w-28 lg:h-28 rounded-full overflow-hidden bg-white cursor-zoom-in"
                                  title="See the photo full size"
                                  aria-label={`See ${selectedMember.name}'s photo full size`}
                                >
                                  <img src={selectedMember.avatarUrl} alt={selectedMember.name} className="w-full h-full object-cover" />
                                </button>
                              </div>
                            ) : (
                              /* NO PHOTO YET: the circle IS the way in. Rory,
                                 looking straight at this: "probably more
                                 importantly by clicking the profile picker
                                 image". An initials circle reads as a slot
                                 waiting to be filled, so tapping it should fill
                                 it rather than do nothing. Non-admins get the
                                 plain circle — the same people who have no Edit
                                 button beside the name. */
                              <div className="avatar-ring">
                                {isAdmin ? (
                                  <button
                                    type="button"
                                    onClick={() => setIsEditingProfile(true)}
                                    className={`group w-24 h-24 lg:w-28 lg:h-28 rounded-full ${warmAvatarColor(selectedMember.avatarColor)} text-white font-bold text-3xl flex items-center justify-center uppercase cursor-pointer relative overflow-hidden`}
                                    title={`Add a photo for ${selectedMember.name}`}
                                    aria-label={`Add a photo for ${selectedMember.name}`}
                                  >
                                    {selectedMember.name.charAt(0).toUpperCase()}
                                    <span className="absolute inset-0 bg-ink-900/45 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity flex items-center justify-center">
                                      <Camera className="w-7 h-7" />
                                    </span>
                                  </button>
                                ) : (
                                  <div className={`w-24 h-24 lg:w-28 lg:h-28 rounded-full ${warmAvatarColor(selectedMember.avatarColor)} text-white font-bold text-3xl flex items-center justify-center uppercase`}>
                                    {selectedMember.name.charAt(0).toUpperCase()}
                                  </div>
                                )}
                              </div>
                            )}
                            {selectedMember.avatarUrl && isAdmin && (
                              <button
                                type="button"
                                onClick={() => setPhotoMenuFor(selectedMember.id)}
                                /* SIZED OFF THE APPS THAT DO THIS WELL. Rory,
                                   on the 36px version: "camera icon is way to
                                   big … make it like other apps size". A badge
                                   on a profile photo sits at roughly a quarter
                                   of the avatar — WhatsApp, Instagram and
                                   Facebook all land in that band — so on a
                                   96px circle that is 28px, not 36. It keeps
                                   the clay and the white ring, which are what
                                   make it read as a control rather than
                                   decoration; only the scale was wrong. */
                                className="absolute bottom-0.5 right-0.5 w-7 h-7 rounded-full bg-clay-500 hover:bg-clay-600 text-white flex items-center justify-center shadow-soft ring-2 ring-white transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                                title="Change photo, or make a fun avatar"
                                aria-label={`Photo options for ${selectedMember.name}`}
                                aria-haspopup="menu"
                              >
                                <Camera className="w-3.5 h-3.5" strokeWidth={2.25} />
                              </button>
                            )}
                            {photoMenuFor === selectedMember.id && selectedMember.avatarUrl && (
                              <>
                                <div
                                  className="fixed inset-0 z-40"
                                  onClick={() => setPhotoMenuFor(null)}
                                  aria-hidden="true"
                                />
                                <div
                                  role="menu"
                                  className="absolute z-50 top-full left-0 mt-2 w-56 rounded-2xl border border-cream-200 bg-white shadow-lift overflow-hidden py-1"
                                >
                                  {[
                                    /* "See full size" used to live here. It is
                                       what tapping the photo does now, so
                                       keeping it would be a menu item for a
                                       gesture the user already made. */
                                    { icon: Camera, label: 'Change photo', run: () => setIsEditingProfile(true) },
                                    { icon: Sparkles, label: 'Make a fun avatar', run: () => (canUseAI ? setRestyleMemberId(selectedMember.id) : setConsentOpen(true)) },
                                  ].map(({ icon: Icon, label, run }) => (
                                    <button
                                      key={label}
                                      type="button"
                                      role="menuitem"
                                      onClick={() => { setPhotoMenuFor(null); run(); }}
                                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[13.5px] font-semibold text-ink-800 hover:bg-cream-100 transition-colors cursor-pointer"
                                    >
                                      <Icon className="w-4 h-4 text-ink-400 shrink-0" /> {label}
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                          <div className="min-w-0">
                            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-ink-900 flex items-center gap-2.5 flex-wrap">
                              <span className="truncate">{memberName(selectedMember)}</span>
                              <button
                                type="button"
                                onClick={() => setShowMemberCalendar(true)}
                                className="p-1.5 rounded-lg bg-cream-200 hover:bg-cream-300 text-ink-600 transition-colors cursor-pointer"
                                title="Relevant dates"
                                aria-label={`${selectedMember.name}'s relevant dates`}
                              >
                                <Calendar className="w-3.5 h-3.5" />
                              </button>
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => setIsEditingProfile(true)}
                                  className="text-[12px] font-sans font-semibold bg-cream-200 hover:bg-cream-300 text-ink-600 px-2.5 py-1 rounded-lg transition-colors cursor-pointer select-none"
                                >
                                  Edit
                                </button>
                              )}
                            </h2>
                            <p className="text-[12px] text-ink-500 font-medium mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="chip bg-cream-200 text-ink-600">{selectedMember.role}</span>
                              {selectedMember.birthdate && (
                                <>
                                  <span className="chip bg-dusk-100 text-dusk-700 tabular-nums">{calculateAge(selectedMember.birthdate)}</span>
                                  <span className="text-ink-400 tabular-nums">
                                    born {selectedMember.birthdate}
                                    {selectedMember.birthTime ? ` at ${selectedMember.birthTime}` : ''}
                                  </span>
                                </>
                              )}
                              {(selectedMember.placeOfBirth || selectedMember.birthHospital) && (
                                <span className="text-ink-400">
                                  · {[selectedMember.placeOfBirth, selectedMember.birthHospital].filter(Boolean).join(', ')}
                                </span>
                              )}
                              {(selectedMember.birthdate || selectedMember.nameDay || (selectedMember.nameCelebrations || []).length > 0) && (
                                <HideDatesButton
                                  showHiddenState
                                  className="-my-1"
                                  target={{ key: hiddenKey.member(selectedMember.id), name: selectedMember.name, dates: memberDates(selectedMember) }}
                                />
                              )}
                            </p>
                            {/* Contact & address — visible to every family member.
                                Always shown so there's a clear place per member; admins
                                get an "Add" shortcut when nothing's filled in yet. */}
                            {(() => {
                              const hasContact = !!(selectedMember.address || selectedMember.phone || selectedMember.email);
                              if (!hasContact && !isAdmin) return null;
                              return (
                                <div className="mt-2 flex flex-col gap-1 text-[12.5px] text-ink-600">
                                  {selectedMember.address && (
                                    <a
                                      href={`https://maps.google.com/?q=${encodeURIComponent(selectedMember.address)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-start gap-1.5 hover:text-clay-600 transition-colors"
                                    >
                                      <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-clay-500" />
                                      <span className="font-medium">{selectedMember.address}</span>
                                    </a>
                                  )}
                                  {selectedMember.phone && (
                                    <a href={`tel:${selectedMember.phone}`} className="flex items-center gap-1.5 hover:text-clay-600 transition-colors">
                                      <Phone className="w-3.5 h-3.5 shrink-0 text-sage-600" />
                                      <span className="font-medium tabular-nums">{selectedMember.phone}</span>
                                    </a>
                                  )}
                                  {selectedMember.email && (
                                    <a href={`mailto:${selectedMember.email}`} className="flex items-center gap-1.5 hover:text-clay-600 transition-colors">
                                      <Mail className="w-3.5 h-3.5 shrink-0 text-dusk-600" />
                                      <span className="font-medium break-all">{selectedMember.email}</span>
                                    </a>
                                  )}
                                  {!hasContact && isAdmin && (
                                    <button
                                      type="button"
                                      onClick={() => setIsEditingProfile(true)}
                                      className="flex items-center gap-1.5 text-ink-400 hover:text-clay-600 transition-colors w-fit"
                                    >
                                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                                      <span className="font-medium">Add address &amp; contact</span>
                                    </button>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </div>

                        {emberInterface ? (
                          <div className="ember-profile-navigation">
                            <div className="ember-profile-lenses" role="tablist" aria-label="Profile lenses">
                              {PROFILE_LENSES.map((lens) => {
                                const lensTabs = visibleProfileTabs.filter((tab) => lens.tabs.includes(tab.id));
                                if (!lensTabs.length) return null;
                                return (
                                  <button
                                    key={lens.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={activeProfileLens === lens.id}
                                    className={activeProfileLens === lens.id ? 'is-active' : ''}
                                    onClick={() => setActiveTab(lensTabs[0].id)}
                                  >
                                    <b>{lens.label}</b><small>{lens.note}</small>
                                  </button>
                                );
                              })}
                            </div>
                            <div className="ember-profile-subtabs" aria-label={`${PROFILE_LENSES.find((lens) => lens.id === activeProfileLens)?.label || 'Profile'} sections`}>
                              {visibleProfileTabs.filter((tab) => profileLensFor(tab.id) === activeProfileLens).map((tab) => (
                                <button
                                  key={tab.id}
                                  type="button"
                                  onClick={() => setActiveTab(tab.id)}
                                  aria-current={activeTab === tab.id ? 'page' : undefined}
                                  className={activeTab === tab.id ? 'is-active' : ''}
                                >
                                  <tab.icon className="h-3.5 w-3.5" /><span>{tab.label}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                        <div className="flex flex-wrap gap-1 bg-cream-200 p-1 rounded-2xl w-fit self-start md:self-auto select-none">
                          {/* 'secrets' is admin-only — it holds this person's saved
                              logins (digitalAccounts[].passwordPlain). Same gate as
                              the shared password vault ('passwords' in the nav filter
                              above). The real enforcement is server-side in
                              /api/vault/reveal; this just stops showing a tab that
                              can no longer decrypt anything. */}
                          {visibleProfileTabs.map(tab => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setActiveTab(tab.id)}
                              // The label below is display:none under `sm`, which takes it out
                              // of the accessibility tree as well as off the screen — so on a
                              // phone, where nearly everyone is, these 14 tabs were unnamed
                              // icons. title carries the name for assistive tech and gives
                              // desktop a tooltip it didn't have either.
                              title={tab.label}
                              aria-label={tab.label}
                              aria-current={activeTab === tab.id ? 'page' : undefined}
                              className={`tab-pill px-3 ${activeTab === tab.id ? 'tab-pill-active' : ''}`}
                            >
                              <tab.icon className={`w-4 h-4 ${tab.id === 'favorites' ? 'fill-rosa-500 text-rosa-500' : ''}`} />
                              <span>{tab.label}</span>
                            </button>
                          ))}
                        </div>
                        )}
                      </div>

                      <div className="p-5 sm:p-6 flex-1">
                          {/* Enter-only animation: an exit phase can stall in throttled background tabs */}
                          <motion.div
                            key={activeTab + '-' + selectedMember.id}
                            initial={{ opacity: 0, y: 3 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.12 }}
                          >
                            <>
                              {activeTab === 'overview' && (
                                <MemberOverview
                                  member={selectedMember}
                                  canEdit={!demo && canWrite}
                                  isBusinessSpace={isBusinessSpace}
                                  showAstrology={!!settings.astrology}
                                  onShuffleAstrology={isAdmin ? () => (canUseAI ? shuffleAstrology(selectedMember.id) : setConsentOpen(true)) : undefined}
                                  astrologyBlurb={astroBlurb[selectedMember.id]}
                                  astrologyCappedToday={astrologyCappedToday}
                                  onSetNameDay={!demo && canWrite ? (date, feast) => {
                                    void persistChanges(membersRef.current.map(m => (
                                      m.id === selectedMember.id ? { ...m, nameDay: date, nameDayFeast: feast } : m
                                    )));
                                  } : undefined}
                                />
                              )}
                              {/* `events` is the shared family calendar. Both of these
                                  screens READ a person's booked appointments from it —
                                  they do not keep their own copy, so an appointment
                                  edited or deleted on the calendar is immediately right
                                  everywhere it appears. */}
                              {activeTab === 'medical' && (
                                <MemberMedical
                                  member={selectedMember}
                                  onUpdate={handlePatchSelectedMember}
                                  country={settings.country || 'AT'}
                                  events={events}
                                  members={members}
                                  onOpenCalendar={() => setMainView('calendar')}
                                  onOpenHistory={() => { setHealthTimelineMemberId(selectedMember.id); setShowHealthTimeline(true); }}
                                  onTagEvent={!demo && canWrite && !isBusinessSpace ? handleTagEventToMember : undefined}
                                  meMemberId={me?.id}
                                  spaceId={activeSpaceId || ''}
                                  isBusinessSpace={isBusinessSpace}
                                />
                              )}
                              {activeTab === 'care' && (
                                <CareSchedule
                                  member={selectedMember}
                                  onUpdate={handlePatchSelectedMember}
                                  events={events}
                                  members={members}
                                  onOpenCalendar={() => setMainView('calendar')}
                                  onTagEvent={!demo && canWrite && !isBusinessSpace ? handleTagEventToMember : undefined}
                                  meMemberId={me?.id}
                                  spaceId={activeSpaceId || ''}
                                />
                              )}
                              {activeTab === 'ids' && (
                                <MemberIDs member={selectedMember} onUpdate={handlePatchSelectedMember} onAddDocument={handleAddDocument} country={settings.country || 'AT'} onOpenPrivacy={() => setLegalTab('privacy')} isBusinessSpace={isBusinessSpace} onViewDocument={handleViewDocument} />
                              )}
                              {activeTab === 'guardians' && (
                                <MemberGuardians member={selectedMember} onUpdate={handlePatchSelectedMember} />
                              )}
                              {activeTab === 'sizes' && (
                                <MemberSizing member={selectedMember} onUpdateSizes={handleUpdateSizes} />
                              )}
                              {activeTab === 'favorites' && (
                                <MemberFavorites member={selectedMember} onUpdateMember={handleUpdateMember} />
                              )}
                              {activeTab === 'growth' && (
                                <GrowthTracker member={selectedMember} onUpdateMember={handleUpdateMember} />
                              )}
                              {activeTab === 'timelapse' && (
                                <BirthdayTimelapse member={selectedMember} onUpdateMember={handleUpdateMember} />
                              )}
                              {activeTab === 'travel' && (
                                <MemberTravel member={selectedMember} onUpdate={handlePatchSelectedMember} />
                              )}
                              {activeTab === 'preferences' && (
                                isBusinessSpace
                                  ? <MemberEmployeePreferences member={selectedMember} onUpdate={handlePatchSelectedMember} canEdit={demo || canWrite} />
                                  : <MemberPreferences member={selectedMember} onUpdate={handlePatchSelectedMember} />
                              )}
                              {activeTab === 'timeline' && (
                                <Suspense fallback={<div className="py-16 text-center text-[13px] text-ink-400">Loading…</div>}>
                                  <TimelineView
                                    key={aiDataVersion}
                                    openImportInitially={buildTimelineOnOpen}
                                    onInitialImportHandled={() => setBuildTimelineOnOpen(false)}
                                    memberId={selectedMember.id}
                                    members={members}
                                    events={events}
                                    canEdit={demo || canWrite}
                                    demo={demo}
                                    onOpenMemberTab={goToMemberTab}
                                    onOpenHealth={(id) => { setHealthTimelineMemberId(id); setShowHealthTimeline(true); }}
                                    onOpenView={(view) => setMainView(view)}
                                  />
                                </Suspense>
                              )}
                              {activeTab === 'sayings' && (
                                <>
                                  <MemberSayings member={selectedMember} onUpdateMember={handleUpdateMember} canEdit={demo || canWrite} />
                                  <div className="border-t border-cream-200 my-2" />
                                  <MemberFavoriteQuotes member={selectedMember} onUpdateMember={handleUpdateMember} canEdit={demo || canWrite} />
                                </>
                              )}
                              {activeTab === 'addresses' && (
                                <MemberAddresses key={selectedMember.id} member={selectedMember} canEdit={demo || canWrite}
                                  onUpdate={async (patch) => {
                                    if (!demo && !canWrite) return;
                                    await persistChanges(membersRef.current.map(m => m.id === selectedMember.id ? { ...m, ...patch } : m));
                                  }} />
                              )}
                              {activeTab === 'education' && (
                                <MemberEducation key={selectedMember.id} member={selectedMember} canEdit={demo || canWrite}
                                  onUpdate={async (patch) => {
                                    if (!demo && !canWrite) return;
                                    await persistChanges(membersRef.current.map(m => m.id === selectedMember.id ? { ...m, ...patch } : m));
                                  }} onViewDocument={handleViewDocument} />
                              )}
                              {activeTab === 'documents' && (
                                <MemberDocuments
                                  member={selectedMember}
                                  onAddDocument={handleAddDocument}
                                  onDeleteDocument={handleDeleteDocument}
                                  onViewDocument={handleViewDocument}
                                  isBusinessSpace={isBusinessSpace}
                                />
                              )}
                              {activeTab === 'secrets' && (
                                isAdmin
                                  ? <SecureSecrets member={selectedMember} onUpdateMember={handleUpdateMember} onOpenPrivacy={() => setLegalTab('privacy')} isBusinessSpace={isBusinessSpace} />
                                  : (
                                    <div className="card text-center py-16 px-4">
                                      <div className="w-12 h-12 rounded-2xl bg-cream-200 text-ink-400 flex items-center justify-center mx-auto mb-3">
                                        <Key className="w-6 h-6" />
                                      </div>
                                      <h3 className="text-sm font-semibold text-ink-800">Admins only</h3>
                                      <p className="text-[13px] text-ink-400 mt-1">Saved logins can only be viewed by {isBusinessSpace ? 'a business admin' : 'a family admin'}.</p>
                                    </div>
                                  )
                              )}
                              {activeTab === 'cv' && (
                                <MemberCV
                                  member={selectedMember}
                                  onUpdate={handlePatchSelectedMember}
                                  onViewDocument={handleViewDocument}
                                  canEdit={demo || canWrite}
                                  onBuildTimeline={!isBusinessSpace ? () => {setBuildTimelineOnOpen(true);setActiveTab('timeline');} : undefined}
                                />
                              )}
                            </>
                          </motion.div>
                      </div>
                    </div>
                  ) : (
                    <div className="card text-center py-24 px-4">
                      <div className="w-14 h-14 rounded-2xl bg-clay-50 text-clay-600 flex items-center justify-center mx-auto mb-3">
                        <User className="w-7 h-7" />
                      </div>
                      <h3 className="text-sm font-semibold text-ink-800">No one selected</h3>
                      <p className="text-[13px] text-ink-400 mt-1">Pick {isBusinessSpace ? 'a team member' : 'a family member'} from the list to see their things.</p>
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* The shared whiteboard and keepsakes support the people; they
                follow the profiles instead of pushing those profiles below a
                long administrative checklist. */}
            <FamilyStatus
              status={demo
                ? { text: 'Everyone at Oma’s until Sunday — Ben’s party is Saturday 3pm.', by: 'Mama', at: new Date(Date.now() - 5 * 3600_000).toISOString() }
                : settings.status}
              canWrite={!demo && canWrite}
              authorName={currentUser?.displayName || currentUser?.email || 'Someone'}
              onSave={(next) => { void handleSaveSettings({ ...settings, status: next }); }}
              isBusinessSpace={isBusinessSpace}
            />

            <OnThisDay members={members} events={events} extendedBirthdays={homeExtendedBirthdays} />

            {!isBusinessSpace && (
              <>
                <FamilyWordOfDay demo={demo} onOpen={() => setMainView('familyWords')} />
                <FlashbackCard members={members} events={events} />
                <div className="flex flex-wrap gap-2">
                  <button data-tour="quick-emergency" type="button" onClick={() => setShowEmergency(true)} className="btn-quiet px-3.5 py-2 text-[13px]"><Siren className="w-4 h-4" /><span>Emergency</span></button>
                  <button type="button" onClick={() => setShowBabysitter(true)} className="btn-quiet px-3.5 py-2 text-[13px]"><Baby className="w-4 h-4" /><span>Babysitter</span></button>
                  <button type="button" onClick={() => setShowTravelPack(true)} className="btn-quiet px-3.5 py-2 text-[13px]"><Plane className="w-4 h-4" /><span>Travel pack</span></button>
                  <button type="button" onClick={() => setShowFamilyStats(true)} className="btn-quiet px-3.5 py-2 text-[13px]"><BarChart3 className="w-4 h-4" /><span>Family stats</span></button>
                  <button type="button" onClick={() => setShowFamilyQuiz(true)} className="btn-quiet px-3.5 py-2 text-[13px]"><HelpCircle className="w-4 h-4" /><span>Quiz</span></button>
                  <button type="button" onClick={() => { setHealthTimelineMemberId(null); setShowHealthTimeline(true); }} className="btn-quiet px-3.5 py-2 text-[13px]"><HeartPulse className="w-4 h-4" /><span>Health timeline</span></button>
                </div>
              </>
            )}
              </>
            )}
          </>
        )}
        </Suspense>
      </main>

      {/* Footer with honest sync status */}
      {!emergencyFocus && <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12 text-center pb-6">
        <div className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white rounded-full border border-cream-300/70 shadow-soft text-[12px] font-semibold text-ink-500">
          {demo ? (
            <>
              <span className="w-2 h-2 bg-honey-500 rounded-full"></span>
              <span>Demo preview — nothing is saved</span>
              {/* Demo mode is entered by adding ?demo=1 and left ONLY by removing it
                  again. In a browser tab you can edit the address bar. In an
                  INSTALLED app — the whole point of this being a PWA — there is no
                  address bar, so tapping "take a peek at the demo" was a one-way
                  door with no way back to signing in. Hence a real button. */}
              <a
                href="/"
                className="ml-1 pl-3 border-l border-cream-300 text-clay-600 hover:text-clay-700 font-semibold"
              >
                Sign in
              </a>
            </>
          ) : cloudSynced === false ? (
            <>
              <CloudOff className="w-3.5 h-3.5 text-honey-700" />
              <span>Saved on this device — not backed up to the cloud</span>
            </>
          ) : (
            <>
              <Cloud className="w-3.5 h-3.5 text-sage-600" />
              <span>Private to your Google account{cloudSynced ? ' · synced' : ''}</span>
            </>
          )}
        </div>
        <div className="mt-3 text-[11px] text-ink-400">
          <button onClick={() => setLegalTab('privacy')} className="underline underline-offset-2 hover:text-ink-600 cursor-pointer">Privacy</button>
          <span className="mx-1.5">·</span>
          <button onClick={() => setLegalTab('terms')} className="underline underline-offset-2 hover:text-ink-600 cursor-pointer">Terms</button>
        </div>
      </footer>}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 card px-5 py-3 text-[13px] font-semibold text-ink-800 flex items-center gap-2"
          >
            <CloudOff className="w-4 h-4 text-honey-700 shrink-0" />
            <span>{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <DocumentViewer
        document={selectedDocument}
        memberName={selectedDocumentMemberName}
        onClose={() => {
          setSelectedDocument(null);
          setSelectedDocumentMemberName('');
        }}
      />

      {emberInterface && (
        <CaptureMenu
          open={isCaptureOpen}
          onClose={() => setIsCaptureOpen(false)}
          onAddPerson={() => setIsAddModalOpen(true)}
          onPlan={() => { setMainView('calendar'); setCapturePlanSignal(signal => signal + 1); }}
          onOpenVault={() => { setMainView('vault'); setCaptureVaultSignal(signal => signal + 1); }}
          onOpenStory={() => { setMainView('timeline'); setCaptureStorySignal(signal => signal + 1); }}
          onOpenHouse={() => { setMainView('household'); setCaptureHouseSignal(signal => signal + 1); }}
          isBusinessSpace={isBusinessSpace}
        />
      )}

      <AddMemberModal
        isOpen={isAddModalOpen}
        onClose={() => { setIsAddModalOpen(false); setAddMemberInitialRole(undefined); setAddingChildFromTree(false); }}
        onAdd={handleAddMember}
        isBusinessSpace={isBusinessSpace}
        initialRole={addMemberInitialRole}
      />

      <EditMemberModal
        isOpen={isEditingProfile}
        member={selectedMember}
        onClose={() => setIsEditingProfile(false)}
        onSave={handleUpdateMember}
        isBusinessSpace={isBusinessSpace}
      />

      {showMemberCalendar && selectedMember && (
        <MemberCalendarDates
          member={selectedMember}
          isBusinessSpace={isBusinessSpace}
          onClose={() => setShowMemberCalendar(false)}
          onGoTab={(tab) => { goToMemberTab(selectedMember.id, tab); setShowMemberCalendar(false); }}
          onGoView={(view) => { setMainView(view as ViewId); setShowMemberCalendar(false); }}
        />
      )}

      <HubSettingsModal
        isOpen={isSettingsOpen}
        settings={settings}
        isBusinessSpace={isBusinessSpace}
        namePlaceholder={activeSpaceName}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveSettings}
        onReplayTour={() => { setIsSettingsOpen(false); setTourReplayKey((k) => k + 1); }}
        onOpenInterview={!isBusinessSpace && (demo || canWrite) ? () => { setIsSettingsOpen(false); setInterviewReplayKey((k) => k + 1); } : undefined}
      />

      {/* Guided setup interview: fills an empty vault with the highest-value
          facts (who's in the family, blood group/allergies, who to call, a
          passport) before the tour ever runs — see FamilyInterview.tsx's
          header comment for the full reasoning. Family spaces only, and only
          for someone who can actually write (children can't). `onSettled`
          opens the FirstRunTour gate below whether or not it actually ran. */}
      {!emergencyFocus && <FamilyInterview
        uid={auth.currentUser?.uid ?? null}
        demo={demo}
        ready={initialLoadDone && !consentOpen}
        enabled={!isBusinessSpace && (demo || canWrite)}
        members={members}
        settings={settings}
        onAddMember={handleAddMember}
        onPatchMember={handlePatchMember}
        onAddDocument={handleAddDocument}
        onSaveSettings={handleSaveSettings}
        onSettled={() => setInterviewGateOpen(true)}
        forceKey={interviewReplayKey}
      />}

      {/* First-run tour: highlights the handful of things worth knowing on
          day one (see FirstRunTour.tsx for the full stop list and why each
          one earned its place). `ready` withholds it until real data has
          loaded, the AI consent prompt (if any) has been dealt with, AND the
          guided setup interview above has settled — so at most one of the
          three ever has the screen. */}
      {!emergencyFocus && <FirstRunTour
        uid={auth.currentUser?.uid ?? null}
        demo={demo}
        ready={initialLoadDone && !consentOpen && interviewGateOpen}
        hubName={hubName}
        isBusinessSpace={isBusinessSpace}
        membersCount={members.length}
        canUseAI={canUseAI}
        forceKey={tourReplayKey}
      />}

      <ImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />

      {/* Floating AI assistant — only when AI is enabled (opt-in, off by default) */}
      {canUseAI && !emergencyFocus && (
        <AssistantBubble
          members={members}
          onApplyEdits={handleApplyAiEdits}
          onAddMemberDoc={handleAddDocument}
          onAddReferral={handleAddReferral}
          onUndoEdits={handleUndoAiEdits}
          demo={demo}
          isBusinessSpace={isBusinessSpace}
          onOpenFunAvatar={isAdmin && selectedMember ? () => setRestyleMemberId(selectedMember.id) : undefined}
          onGo={goToMemberTab}
          onGoView={(v) => setMainView(v as ViewId)}
          onPrepareExport={handlePrepareExport}
          openSignal={assistantOpenSignal}
        />
      )}

      {/* jsPDF (~336KB minified — roughly 10% of the OLD main chunk) only
          arrives on the wire the first time someone actually asks to export a
          pack, via ExportPackModal.tsx's static `import jsPDF from 'jspdf'`.
          Stays mounted once opened (rather than unmounting the instant
          exportRequest goes back to null) so its own close animation
          (AnimatePresence around its `open` prop) still plays normally. */}
      {exportEverRequested && (
        <Suspense fallback={null}>
          <ExportPackModal
            open={!!exportRequest}
            request={exportRequest}
            members={members}
            events={events}
            vaultDocuments={exportVaultDocs}
            providers={exportProviders}
            spaceName={settings.familyName}
            onClose={() => setExportRequest(null)}
          />
        </Suspense>
      )}

      <AiConsentModal
        open={consentOpen}
        onEnable={async () => { await setAiConsent(true); setConsentOpen(false); }}
        onClose={() => setConsentOpen(false)}
        onOpenPrivacy={() => setLegalTab('privacy')}
      />

      <FeedbackModal
        open={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
        screen={mainView}
        screenLabel={viewLabel(mainView, t, isBusinessSpace)}
      />

      <ConnectedFamilies
        open={connectedOpen}
        onClose={() => setConnectedOpen(false)}
        isAdmin={isAdmin}
        members={members}
        hubName={hubName}
      />

      {legalTab && <LegalModal tab={legalTab} onClose={() => setLegalTab(null)} />}

      {restyleMemberId && (() => {
        const m = members.find((x) => x.id === restyleMemberId);
        return m ? (
          <AvatarRestyleModal
            member={m}
            onClose={() => setRestyleMemberId(null)}
            onApply={handleRestyleApply}
            onReset={handleRestyleReset}
          />
        ) : null;
      })()}

      {showEmergency && (
        <EmergencyCard members={members} events={events} country={settings.country || 'AT'} onClose={() => setShowEmergency(false)} />
      )}
      {showBabysitter && (
        <BabysitterMode members={members} events={events} country={settings.country || 'AT'} onClose={() => setShowBabysitter(false)} />
      )}
      {showTravelPack && (
        <TravelPack members={members} events={events} onClose={() => setShowTravelPack(false)} />
      )}
      {openTrip && (
        <TripPack
          trip={openTrip}
          travellers={openTripTravellers}
          vaultDocs={tripVaultDocs}
          focusMemberId={tripFocusMemberId}
          canWrite={!demo && canWrite}
          onAttach={handleAttachTripDoc}
          onUploadAttach={!demo && canWrite ? handleUploadTripDoc : undefined}
          onDetach={handleDetachTripDoc}
          onHideDoc={handleHideTripDoc}
          onMove={handleMoveTripDoc}
          onExtractKeyFacts={!demo && canWrite ? handleExtractDocFacts : undefined}
          onGoProfile={(memberId, tab) => {
            // Close the pack BEFORE navigating — the point is to take the
            // person to the fix, not to stack a profile under a modal.
            setOpenTripId(null); setTripFocusMemberId(null);
            goToMemberTab(memberId, tab);
          }}
          onClose={() => { setOpenTripId(null); setTripFocusMemberId(null); }}
        />
      )}
      {showFamilyStats && (
        <FamilyStats members={members} events={events} onClose={() => setShowFamilyStats(false)} />
      )}
      {showFamilyQuiz && (
        <FamilyQuiz members={members} events={events} onClose={() => setShowFamilyQuiz(false)} />
      )}
      {showHealthTimeline && (
        <HealthTimeline
          members={members}
          events={events}
          initialMemberId={healthTimelineMemberId || undefined}
          onClose={() => { setShowHealthTimeline(false); setHealthTimelineMemberId(null); }}
        />
      )}
    </div>
    </HiddenPeopleProvider>
  );
}

function DemoUnavailable({ label, isBusinessSpace = false }: { label: string; isBusinessSpace?: boolean }) {
  return (
    <div className="card ember-honest-state text-center py-20 px-6">
      <p className="ember-kicker">Private by design</p>
      <h3 className="font-display text-xl font-semibold text-ink-900 mt-2 mb-2">{label} stays out of the public demo</h3>
      <p className="text-[13px] text-ink-500 max-w-sm mx-auto leading-relaxed">
        Sign in with Google to use this space with your own {isBusinessSpace ? 'team' : 'family'}. Teluva won&apos;t invent example records for sensitive information.
      </p>
    </div>
  );
}
