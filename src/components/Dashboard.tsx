import React, { useState, useEffect, useRef } from 'react';
import { FamilyMember, ClothingSizes, FamilyDocument, CalendarEvent, AssetItem, ContactEntry } from '../types';
import { useT } from '../i18n/LangContext';
import { Strings } from '../i18n/locales';
import { useFamilyCtx } from '../contexts/FamilyContext';
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
  saveAsset,
  loadFamilyWords, saveFamilyWords,
} from '../utils/db';
import {
  applyMemberEdits, applyInfoEdits, hasMemberEdits, hasInfoEdits,
  applyCalendarEdits, applyHouseholdEdits, applyFinancesEdits, applyTimelineEdits,
  hasCalendarEdits, hasHouseholdEdits, hasFinancesEdits, hasTimelineEdits,
  hasShoppingEdits, applyShoppingEdits, hasAssetEdits,
  hasFamilyWordsEdits, applyFamilyWordsEdits,
} from '../utils/aiApply';
import { AiEdit } from './AIChatbot';
import AssistantBubble from './AssistantBubble';
import AiConsentModal from './AiConsentModal';
import AvatarRestyleModal from './AvatarRestyleModal';
import SectionMenu from './SectionMenu';
import LegalModal, { LegalTab } from './LegalModal';
import { compressImageToAvatar } from '../utils/imageCompress';
import HubSettingsModal from './HubSettingsModal';
import ImageLightbox from './ImageLightbox';
import { HubSettings } from '../types';
import { auth, loginWithGoogle, logout } from '../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { DEMO_MEMBERS, DEMO_EVENTS, DEMO_CONTACTS, isDemoMode } from '../utils/demoData';
import { warmAvatarColor, AVATAR_COLORS } from '../utils/avatarPalette';
import AddMemberModal from './AddMemberModal';
import EditMemberModal from './EditMemberModal';
import MemberSizing from './MemberSizing';
import MemberDocuments from './MemberDocuments';
import DocumentViewer from './DocumentViewer';
import GrowthTracker from './GrowthTracker';
import SecureSecrets from './SecureSecrets';
import FamilyCalendar from './FamilyCalendar';
import FamilyChat from './FamilyChat';
import GoogleDriveSync from './GoogleDriveSync';
import ShoppingList from './ShoppingList';
import ImportantInfo from './ImportantInfo';
import MemberFavorites from './MemberFavorites';
import MemberMedical from './MemberMedical';
import MemberOverview from './MemberOverview';
import NeedsAttention from './NeedsAttention';
import MemberIDs from './MemberIDs';
import MemberTravel from './MemberTravel';
import CareSchedule from './CareSchedule';
import MemberPreferences from './MemberPreferences';
import EmergencyView from './EmergencyView';
import HouseholdView from './HouseholdView';
import FinancesView from './FinancesView';
import InsuranceView from './InsuranceView';
import MemberSayings from './MemberSayings';
import FamilyWordsView from './FamilyWordsView';
import VehiclesView from './VehiclesView';
import SpaceSwitcher from './SpaceSwitcher';
import { switchSpace, createSpace, renameSpace } from '../utils/db';
import TimelineView from './TimelineView';
import DocumentVault from './DocumentVault';
import Assets from './Assets';
import FamilyPasswords from './FamilyPasswords';
import OnThisDay from './OnThisDay';
import FamilyWordOfDay from './FamilyWordOfDay';
import FlashbackCard from './FlashbackCard';
import EmergencyCard from './EmergencyCard';
import BabysitterMode from './BabysitterMode';
import TravelPack from './TravelPack';
import FamilyStats from './FamilyStats';
import FamilyQuiz from './FamilyQuiz';
import HealthTimeline from './HealthTimeline';
import { sunSign } from '../utils/astrology';
import {
  Users, UserPlus, FileText, Search, Bell, User, ShieldCheck,
  Scissors, Trash2, Key, TrendingUp, Calendar, Heart,
  LogOut, LogIn, Download, Upload, Cloud, CloudOff, MessageCircle, IdCard,
  HeartPulse, Plane, Sparkles, Siren, Home, Landmark, CalendarHeart, FolderArchive, GripVertical, ShoppingCart,
  Package, KeyRound, MapPin, Phone, Mail, LayoutDashboard, Stethoscope, BarChart3, HelpCircle, Baby,
  Quote, BookHeart, Car
} from 'lucide-react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'motion/react';

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

type TabId = 'overview' | 'sizes' | 'favorites' | 'growth' | 'medical' | 'care' | 'ids' | 'travel' | 'preferences' | 'documents' | 'secrets' | 'sayings';
type ViewId = 'profiles' | 'assistant' | 'calendar' | 'info' | 'emergency' | 'household' | 'finances' | 'insurance' | 'timeline' | 'vault' | 'shopping' | 'chat' | 'drive' | 'assets' | 'passwords' | 'familyWords' | 'vehicles';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'medical', label: 'Medical', icon: HeartPulse },
  { id: 'care', label: 'Care', icon: Stethoscope },
  { id: 'ids', label: 'ID & Passports', icon: IdCard },
  { id: 'sizes', label: 'Sizes', icon: Scissors },
  { id: 'favorites', label: 'Wishlist', icon: Heart },
  { id: 'growth', label: 'Growth', icon: TrendingUp },
  { id: 'travel', label: 'Travel', icon: Plane },
  { id: 'preferences', label: 'Likes', icon: Sparkles },
  { id: 'sayings', label: 'Sayings', icon: Quote },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'secrets', label: 'Secrets', icon: Key },
];

// Kid/family-specific tabs that make no sense for an employee in a business space.
const HIDDEN_IN_BUSINESS: TabId[] = ['care', 'sizes', 'favorites', 'growth', 'sayings'];
// Same idea, one level up — top-level nav sections that are family-only (the
// keepsake dictionary, the family memory timeline, a personal shopping list —
// no small-business equivalent researched). Insurance/Vehicles/Household/
// Assets/Documents/Passwords/Chat/etc. all stay — genuinely useful for a
// business too (Household becomes "Locations", Info becomes "Compliance" —
// see viewLabel below).
// 'emergency' is a medical/allergy/blood-type card — no business equivalent
// exists yet (a real workplace-incident log would be a distinct feature, not
// a relabel of this one) so it's hidden rather than mislabeled.
const HIDDEN_VIEWS_IN_BUSINESS: ViewId[] = ['familyWords', 'timeline', 'shopping', 'emergency'];

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
  { id: 'timeline', icon: CalendarHeart },
  { id: 'vault', icon: FolderArchive },
  { id: 'assets', icon: Package },
  { id: 'shopping', icon: ShoppingCart },
  { id: 'passwords', icon: KeyRound },
  { id: 'familyWords', icon: BookHeart },
  { id: 'chat', icon: MessageCircle },
  { id: 'drive', icon: Cloud },
];

function viewLabel(id: ViewId, t: Strings, isBusinessSpace: boolean): string {
  const map: Partial<Record<ViewId, string>> = {
    profiles: isBusinessSpace ? 'Team' : t.nav_family,
    assistant: t.nav_assistant,
    calendar: t.nav_calendar,
    info: isBusinessSpace ? 'Compliance' : t.nav_info,
    household: isBusinessSpace ? 'Locations' : t.nav_household,
    finances: t.nav_finances,
    timeline: t.nav_timeline,
    vault: t.nav_documents,
    assets: t.nav_assets,
    passwords: t.nav_passwords,
    familyWords: 'Family Words',
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
}

export default function Dashboard({ familySettingsButton }: DashboardProps = {}) {
  const demo = isDemoMode();
  const { isAdmin, canWrite, role, aiEligible, aiConsent, setAiConsent, spaces, familyId: activeSpaceId, loading: ctxLoading } = useFamilyCtx();

  const activeSpaceType = spaces.find((s) => s.id === activeSpaceId)?.type || 'family';
  const isBusinessSpace = activeSpaceType === 'business';

  const handleSwitchSpace = async (spaceId: string) => {
    await switchSpace(spaceId);
    window.location.reload();
  };
  const handleCreateSpace = async (name: string) => {
    await createSpace(name, 'business');

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
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [settings, setSettings] = useState<HubSettings>({});
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<FamilyDocument | null>(null);
  const [selectedDocumentMemberName, setSelectedDocumentMemberName] = useState<string>('');
  const [deleteConfirmMemberId, setDeleteConfirmMemberId] = useState<string | null>(null);

  const [mainView, setMainView] = useState<ViewId>('profiles');
  const [restyleMemberId, setRestyleMemberId] = useState<string | null>(null);
  const [astroBlurb, setAstroBlurb] = useState<Record<string, { text: string; loading: boolean; error: string | null }>>({});
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
  const [showTravelPack, setShowTravelPack] = useState(false);
  const [showFamilyStats, setShowFamilyStats] = useState(false);
  const [showFamilyQuiz, setShowFamilyQuiz] = useState(false);
  const [showHealthTimeline, setShowHealthTimeline] = useState(false);

  // null = no save attempted yet; true/false = last save reached cloud or not
  const [cloudSynced, setCloudSynced] = useState<boolean | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4500);
  };

  useEffect(() => {
    if (demo) {
      setCurrentUser({ displayName: 'Demo family', isDemo: true });
      setMembers(DEMO_MEMBERS);
      setEvents(DEMO_EVENTS);
      setContacts(DEMO_CONTACTS);
      setSelectedMemberId(DEMO_MEMBERS[0].id);
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
      if (!currentUser) {
        setMembers([]);
        setEvents([]);
        setContacts([]);
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
    }
    init();
  }, [currentUser, ctxLoading, activeSpaceId]);

  const hubName = settings.hubName || (isBusinessSpace ? 'Business Hub' : 'Family Hub');

  // How to render a member's name (fun display preference)
  const memberName = (m: FamilyMember) => {
    const mode = settings.nameDisplay || 'both';
    if (mode === 'nick') return m.nickname || m.name;
    if (mode === 'real') return m.name;
    return m.nickname ? `${m.name} “${m.nickname}”` : m.name;
  };

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
    `w-full text-left rounded-2xl border transition-all flex items-center justify-between ${
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
          <span className="text-sm font-semibold text-ink-900 truncate">{memberName(member)}</span>
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
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.blurb) throw new Error(data.error || 'Could not generate a blurb.');
      setAstroBlurb((s) => ({ ...s, [memberId]: { text: data.blurb, loading: false, error: null } }));
      const forInputs = `${member.birthdate || ''}|${member.birthTime || ''}|${member.placeOfBirth || ''}`;
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

  const handleAddMember = async (newMember: Omit<FamilyMember, 'documents'>) => {
    const fullMember: FamilyMember = { ...newMember, documents: [] };
    const updated = [...members, fullMember];
    await persistChanges(updated);
    setSelectedMemberId(fullMember.id);
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

  // Apply edits proposed by the AI assistant (after the user confirms).
  // Throws if any cloud save fails so the chatbot doesn't mark the message
  // as "Applied" when data didn't actually reach Firestore.
  const handleApplyAiEdits = async (edits: AiEdit[]) => {
    const failures: string[] = [];

    if (hasMemberEdits(edits)) {
      const next = applyMemberEdits(membersRef.current, edits, isBusinessSpace);
      membersRef.current = next; // so a following fileScans→handleAddDocument merges onto this
      setMembers(next);
      const ok = await saveFamilyMembers(next);
      if (!ok) failures.push('family members');
    }
    if (hasInfoEdits(edits)) {
      const info = (await loadFamilyInfo()) || { numbers: [], contacts: [], providers: [] };
      const updatedInfo = applyInfoEdits(info, edits);
      const ok = await saveFamilyInfo(updatedInfo);
      if (!ok) failures.push('contacts & numbers');
      // Keep NeedsAttention/OnThisDay's contact-birthday nudges current — they
      // read the top-level `contacts` state (a prop), not a self-load like
      // ImportantInfo's own view, so an AI-added contact needs this explicit push.
      setContacts(updatedInfo.contacts || []);
    }
    if (hasCalendarEdits(edits)) {
      const next = applyCalendarEdits(events, edits, members);
      setEvents(next);
      const ok = await saveCalendarEvents(next);
      if (!ok) failures.push('calendar');
    }
    if (hasHouseholdEdits(edits)) {
      const h = (await loadHousehold()) || {};
      const ok = await saveHousehold(applyHouseholdEdits(h, edits));
      if (!ok) failures.push('household');
    }
    if (hasFinancesEdits(edits)) {
      const f = (await loadFinances()) || {};
      const ok = await saveFinances(applyFinancesEdits(f, edits));
      if (!ok) failures.push('finances');
    }
    if (hasTimelineEdits(edits)) {
      const t = (await loadTimeline()) || { entries: [] };
      const ok = await saveTimeline(applyTimelineEdits(t, edits));
      if (!ok) failures.push('timeline');
    }
    if (hasFamilyWordsEdits(edits)) {
      const doc = (await loadFamilyWords()) || { words: [] };
      const ok = await saveFamilyWords({ words: applyFamilyWordsEdits(doc.words || [], edits) });
      if (!ok) failures.push('family words');
    }
    if (hasShoppingEdits(edits)) {
      const s = await loadShopping();
      const ok = await saveShopping(applyShoppingEdits(s, edits));
      if (!ok) failures.push('shopping');
    }
    if (hasAssetEdits(edits)) {
      const VALID_CATS: AssetItem['category'][] = ['Electronics', 'Bike', 'Sporting', 'Vehicle', 'Jewellery', 'Furniture', 'Other'];
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
          createdAt: new Date().toISOString().slice(0, 10),
        };
        const ok = await saveAsset(asset);
        if (!ok) failures.push('assets');
      }
    }

    // Remount the self-loading views so an applied change shows immediately
    // (these views load their data once on mount and take no props).
    if (
      hasInfoEdits(edits) || hasHouseholdEdits(edits) || hasFinancesEdits(edits) ||
      hasTimelineEdits(edits) || hasShoppingEdits(edits) || hasAssetEdits(edits) ||
      hasFamilyWordsEdits(edits)
    ) {
      setAiDataVersion(v => v + 1);
    }

    if (failures.length > 0) {
      throw new Error(`Couldn't save to cloud: ${failures.join(', ')}. Check your connection and try again.`);
    }
  };

  const handleAddDocument = async (memberId: string, docToAdd: FamilyDocument) => {
    await persistChanges(membersRef.current.map(m => (m.id === memberId ? { ...m, documents: [...(m.documents || []), docToAdd] } : m)));
  };

  const handleDeleteDocument = async (memberId: string, docId: string) => {
    await persistChanges(members.map(m => (m.id === memberId ? { ...m, documents: m.documents.filter(d => d.id !== docId) } : m)));
  };

  const handleUpdateMember = async (updatedMember: FamilyMember) => {
    await persistChanges(members.map(m => (m.id === updatedMember.id ? updatedMember : m)));
  };

  const handleViewDocument = (docToView: FamilyDocument, memberName: string) => {
    setSelectedDocument(docToView);
    setSelectedDocumentMemberName(memberName);
  };

  const handleExportAllData = async () => {
    try {
      const [info, household, finances, timeline, docs] = await Promise.all([
        loadFamilyInfo(),
        loadHousehold(),
        loadFinances(),
        loadTimeline(),
        loadDocuments(),
      ]);

      // Documents: metadata only (no binary content — files live in Cloud Storage)
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
        downloadUrl: d.downloadUrl,
      }));

      const backupData = {
        version: 2,
        exportedAt: new Date().toISOString(),
        author: 'Family Vault backup',
        members,
        calendarEvents: events,
        info: info || null,
        household: household || null,
        finances: finances || null,
        timeline: timeline || null,
        documents: documentsMeta,
        settings,
      };

      const dataStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const exportFileDefaultName = `family_vault_backup_${new Date().toLocaleDateString('en-CA')}.json`;

      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', url);
      linkElement.setAttribute('download', exportFileDefaultName);
      linkElement.click();

      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (error) {
      console.error('Export failed:', error);
      showToast('Could not generate the backup file.');
    }
  };

  const handleImportAllData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Import OVERWRITES the whole family — never do it silently.
    const ok = window.confirm(
      'Restore from this backup? It will REPLACE all current family data — members, calendar, household, finances and more — with the contents of the file. This cannot be undone.'
    );
    if (!ok) { event.target.value = ''; return; }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const backupData = JSON.parse(content);

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

        showToast('Backup imported.');
      } catch (error) {
        console.error('Import failed:', error);
        showToast("Couldn't read that backup file — is it a Family Vault export?");
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const selectedMember = members.find(m => m.id === selectedMemberId);

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
    const forInputs = `${selectedMember.birthdate || ''}|${selectedMember.birthTime || ''}|${selectedMember.placeOfBirth || ''}`;
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
  }, [selectedMember?.id, selectedMember?.birthdate, selectedMember?.birthTime, selectedMember?.placeOfBirth, settings.astrology, isAdmin, canUseAI]);

  // Open every member on their Overview summary (like iOS Contacts) — resets when
  // you switch members, so you no longer always land on the Medical form. A
  // pending-tab ref lets a "Needs attention" nudge deep-link to a specific tab.
  const pendingTabRef = useRef<TabId | null>(null);
  useEffect(() => {
    setActiveTab(pendingTabRef.current ?? 'overview');
    pendingTabRef.current = null;
  }, [selectedMemberId]);

  const goToMemberTab = (memberId: string, tab: string) => {
    if (memberId === selectedMemberId) {
      setActiveTab(tab as TabId);
    } else {
      pendingTabRef.current = tab as TabId;
      setSelectedMemberId(memberId);
    }
    setDeleteConfirmMemberId(null);
  };

  // Renewal notices across passports, permits, licenses and visas (real date)
  const expiryWarnings = (() => {
    const today = new Date();
    const items: { memberName: string; label: string; monthsLeft: number; status: 'expired' | 'critical' }[] = [];
    const consider = (memberName: string, label: string, dateStr?: string, horizonMonths = 9) => {
      if (!dateStr) return;
      const expiry = new Date(dateStr);
      if (isNaN(expiry.getTime())) return;
      const diffTime = expiry.getTime() - today.getTime();
      const monthsLeft = Number((Math.ceil(diffTime / (1000 * 60 * 60 * 24)) / 30.4375).toFixed(1));
      if (diffTime < 0) items.push({ memberName, label, monthsLeft, status: 'expired' });
      else if (monthsLeft <= horizonMonths) items.push({ memberName, label, monthsLeft, status: 'critical' });
    };
    members.forEach(m => {
      consider(m.name, 'passport', m.passport?.expiryDate);
      (m.passports || []).forEach(p => consider(m.name, `${p.country || ''} passport`.trim(), p.expiryDate));
      consider(m.name, 'residence permit', m.identity?.residencePermitExpiry);
      consider(m.name, "driver's license", m.identity?.driversLicenseExpiry);
      (m.travel?.visas || []).forEach(v => consider(m.name, `${v.country || ''} visa`.trim(), v.expiryDate, 6));
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
    return (
      <div
        className="min-h-screen bg-cream-100 flex items-center justify-center font-sans px-4"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 60% 50% at 12% -10%, rgba(253, 240, 234, 0.9), transparent 65%), radial-gradient(ellipse 60% 50% at 88% -10%, rgba(252, 244, 230, 0.9), transparent 65%)',
        }}
      >
        <div className="card p-10 text-center max-w-md w-full">
          <div className="w-16 h-16 rounded-full bg-sage-100 flex items-center justify-center mx-auto mb-5">
            <ShieldCheck className="w-8 h-8 text-sage-600" />
          </div>
          <p className="text-[11px] font-bold text-clay-500 uppercase tracking-wider mb-1">Tresa</p>
          <h1 className="text-display-md text-ink-900 mb-3">{hubName}</h1>
          <p className="text-sm text-ink-500 leading-relaxed mb-8">
            Sizes, documents, growth and plans for the whole family — together in one private place.
          </p>
          <button onClick={loginWithGoogle} className="btn-primary w-full py-3">
            <LogIn className="w-4 h-4" />
            <span>Sign in with Google</span>
          </button>
          <a href="?demo=1" className="inline-block mt-5 text-xs text-ink-400 underline underline-offset-2 hover:text-ink-600">
            or take a peek at the demo
          </a>
          <div className="mt-6 pt-4 border-t border-cream-200 text-[12px] text-ink-400">
            By signing in you agree to our{' '}
            <button onClick={() => setLegalTab('terms')} className="underline underline-offset-2 hover:text-ink-600 cursor-pointer">Terms</button>
            {' '}and{' '}
            <button onClick={() => setLegalTab('privacy')} className="underline underline-offset-2 hover:text-ink-600 cursor-pointer">Privacy Policy</button>.
          </div>
        </div>
        {legalTab && <LegalModal tab={legalTab} onClose={() => setLegalTab(null)} />}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream-100 text-ink-900 pb-12 font-sans">
      {/* Header */}
      <header className="bg-cream-50/90 backdrop-blur border-b border-cream-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {settings.familyPhotoUrl ? (
              <button
                type="button"
                onClick={() => setLightboxImage(settings.familyPhotoUrl!)}
                className="w-9 h-9 rounded-2xl overflow-hidden shrink-0 border border-cream-300 shadow-soft cursor-zoom-in"
                title="View family photo"
              >
                <img src={settings.familyPhotoUrl} alt="Family" className="w-full h-full object-cover" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => !demo && setIsSettingsOpen(true)}
                className={`w-9 h-9 rounded-2xl bg-sage-100 flex items-center justify-center shrink-0 transition-colors ${demo ? '' : 'hover:bg-sage-200 cursor-pointer'}`}
                title={demo ? undefined : 'Hub settings — add a family photo'}
              >
                <ShieldCheck className="w-5 h-5 text-sage-600" />
              </button>
            )}
            <button
              type="button"
              onClick={() => !demo && setIsSettingsOpen(true)}
              className={`text-left rounded-2xl -m-1 p-1 transition-colors ${demo ? '' : 'hover:bg-cream-200/60 cursor-pointer'}`}
              title={demo ? undefined : 'Hub settings — name &amp; family photo'}
            >
              <h1 className="font-display text-lg font-semibold text-ink-900 leading-tight">{hubName}</h1>
              <p className="hidden sm:block text-[11px] text-ink-400 font-medium leading-tight">{isBusinessSpace ? 'Everything for the business, in one place' : 'Everything for the family, in one place'}</p>
            </button>
          </div>

          {/* Space switcher (Family / Business / Personal) — renders nothing
              until an account belongs to more than one space. Not shown in demo
              (demo isn't a real signed-in account, nothing to switch to). */}
          {!demo && <SpaceSwitcher spaces={spaces} activeId={activeSpaceId} canCreate={canWrite} onSwitch={handleSwitchSpace} onCreate={handleCreateSpace} />}

          {/* Main view switcher — a burger dropdown so all sections are reachable
              in one tap, no horizontal sliding. */}
          <SectionMenu
            views={VIEWS
              .filter(view => !(view.id === 'finances' && !canWrite) && !(view.id === 'passwords' && !isAdmin))
              .filter(view => !(isBusinessSpace && HIDDEN_VIEWS_IN_BUSINESS.includes(view.id)))
              .map(view => ({ id: view.id, icon: view.icon, label: viewLabel(view.id, t, isBusinessSpace) }))}
            current={mainView}
            onSelect={(id) => setMainView(id as ViewId)}
          />

          <div className="flex items-center gap-2 ml-auto sm:ml-0">
            {role === 'child' && (
              <span className="text-xs bg-sage-100 text-sage-700 rounded-full px-2 py-0.5 font-semibold">View only</span>
            )}
            {role === 'member' && (
              <span className="text-xs bg-sage-100 text-sage-700 rounded-full px-2 py-0.5 font-semibold">Member</span>
            )}

            {isAdmin && (
              <button onClick={() => setIsAddModalOpen(true)} className="btn-primary px-4 py-2">
                <UserPlus className="w-4 h-4" />
                <span className="hidden sm:inline">{t.btn_add}</span>
              </button>
            )}

            {familySettingsButton}

            {!demo && (
              <>
                <button onClick={handleExportAllData} className="btn-quiet px-3 py-2" title="Download a backup of everything">
                  <Download className="w-4 h-4" />
                </button>
                <label className="btn-quiet px-3 py-2 cursor-pointer" title="Restore from a backup file">
                  <Upload className="w-4 h-4" />
                  <input type="file" accept="application/json" onChange={handleImportAllData} className="hidden" />
                </label>
                <button onClick={logout} className="btn-quiet px-3 py-2" title="Sign out">
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
        {mainView === 'calendar' && (
          <FamilyCalendar members={members} events={events} onSaveEvents={handleSaveEvents} />
        )}

        {mainView === 'info' && <ImportantInfo refreshKey={aiDataVersion} isBusinessSpace={isBusinessSpace} onContactsChange={setContacts} />}

        {mainView === 'emergency' && <EmergencyView members={members} />}

        {mainView === 'household' && <HouseholdView refreshKey={aiDataVersion} isBusinessSpace={isBusinessSpace} />}

        {mainView === 'finances' && <FinancesView refreshKey={aiDataVersion} isBusinessSpace={isBusinessSpace} />}
        {mainView === 'insurance' && <InsuranceView members={members} canUseAI={canUseAI} />}
        {mainView === 'familyWords' && <FamilyWordsView members={members} canEdit={demo || canWrite} demo={demo} refreshKey={aiDataVersion} />}
        {mainView === 'vehicles' && <VehiclesView members={members} canEdit={demo || canWrite} demo={demo} refreshKey={aiDataVersion} />}

        {mainView === 'timeline' && <TimelineView key={aiDataVersion} />}

        {mainView === 'vault' && (
          demo ? <DemoUnavailable label="The document vault" /> : <DocumentVault members={members} isBusinessSpace={isBusinessSpace} />
        )}

        {mainView === 'shopping' && (
          demo ? <DemoUnavailable label="The shopping list" /> : <ShoppingList key={aiDataVersion} />
        )}

        {mainView === 'chat' && (
          demo ? (
            <DemoUnavailable label="Family chat" />
          ) : (
            <FamilyChat members={members} selectedMemberId={selectedMemberId} />
          )
        )}

        {mainView === 'drive' && (
          demo ? <DemoUnavailable label="Drive sync" /> : <GoogleDriveSync />
        )}

        {mainView === 'assets' && (
          demo ? <DemoUnavailable label="Family assets" /> : <Assets key={aiDataVersion} />
        )}

        {mainView === 'passwords' && (
          demo ? <DemoUnavailable label="Family passwords" /> : <FamilyPasswords />
        )}

        {mainView === 'profiles' && (
          <>
            <NeedsAttention members={members} contacts={contacts} onGo={goToMemberTab} onGoView={(v) => setMainView(v as ViewId)} />

            <OnThisDay members={members} events={events} contacts={contacts} />

            {!isBusinessSpace && (
              <>
                <FamilyWordOfDay demo={demo} onOpen={() => setMainView('familyWords')} />
                <FlashbackCard members={members} events={events} />
              </>
            )}

            {/* Quick actions — one-tap entry into the full-screen feature modals (family-only) */}
            {!isBusinessSpace && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setShowEmergency(true)} className="btn-quiet px-3.5 py-2 text-[13px]">
                  <Siren className="w-4 h-4" />
                  <span>Emergency</span>
                </button>
                <button type="button" onClick={() => setShowBabysitter(true)} className="btn-quiet px-3.5 py-2 text-[13px]">
                  <Baby className="w-4 h-4" />
                  <span>Babysitter</span>
                </button>
                <button type="button" onClick={() => setShowTravelPack(true)} className="btn-quiet px-3.5 py-2 text-[13px]">
                  <Plane className="w-4 h-4" />
                  <span>Travel pack</span>
                </button>
                <button type="button" onClick={() => setShowFamilyStats(true)} className="btn-quiet px-3.5 py-2 text-[13px]">
                  <BarChart3 className="w-4 h-4" />
                  <span>Family stats</span>
                </button>
                <button type="button" onClick={() => setShowFamilyQuiz(true)} className="btn-quiet px-3.5 py-2 text-[13px]">
                  <HelpCircle className="w-4 h-4" />
                  <span>Quiz</span>
                </button>
                <button type="button" onClick={() => setShowHealthTimeline(true)} className="btn-quiet px-3.5 py-2 text-[13px]">
                  <HeartPulse className="w-4 h-4" />
                  <span>Health timeline</span>
                </button>
              </div>
            )}

            {members.length === 0 ? (
              <div className="card text-center py-20 px-6">
                <div className="w-16 h-16 rounded-2xl bg-clay-50 text-clay-600 flex items-center justify-center mx-auto mb-5">
                  <Users className="w-8 h-8" />
                </div>
                <h2 className="text-display-sm text-ink-900 mb-2">Welcome to your {hubName}</h2>
                <p className="text-sm text-ink-500 max-w-md mx-auto mb-7">
                  {isBusinessSpace
                    ? 'Keep your team, vehicles, leases, insurance and documents in one tidy, private place.'
                    : "Keep everyone's clothing sizes, documents, growth history and wish lists in one tidy, private place."}
                </p>
                {isAdmin && (
                  <button onClick={() => setIsAddModalOpen(true)} className="btn-primary">
                    <UserPlus className="w-4 h-4" />
                    <span>{isBusinessSpace ? 'Add your first team member' : 'Add your first family member'}</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Family directory */}
                <section className="lg:col-span-4 space-y-5">
                  <div className="card p-5 space-y-4">
                    <div className="flex items-center justify-between pb-3.5 border-b border-cream-200">
                      <h4 className="section-label">{isBusinessSpace ? 'Your team' : 'Your family'}</h4>
                      <span className="chip bg-cream-200 text-ink-600 tabular-nums">
                        {members.length} member{members.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    <Reorder.Group axis="y" values={members} onReorder={handleReorder} className="space-y-2.5">
                        {members.map((member) => (
                          <DraggableRow
                            key={member.id}
                            member={member}
                            className={`${cardClass(member)} cursor-pointer`}
                            onSelect={() => { setSelectedMemberId(member.id); setDeleteConfirmMemberId(null); }}
                            onDragEnd={saveOrder}
                            renderInner={memberCardInner}
                          />
                        ))}
                      </Reorder.Group>
                  </div>
                </section>

                {/* Selected member detail */}
                <section className="lg:col-span-8 space-y-5">
                  {selectedMember ? (
                    <div className="card overflow-hidden min-h-[500px] flex flex-col">
                      <div className="p-5 sm:p-6 border-b border-cream-200 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="relative shrink-0">
                            {selectedMember.avatarUrl ? (
                              <div className="avatar-ring">
                                <button
                                  type="button"
                                  onClick={() => setLightboxImage(selectedMember.avatarUrl!)}
                                  className="block w-24 h-24 lg:w-28 lg:h-28 rounded-full overflow-hidden bg-white cursor-zoom-in"
                                  title="View photo"
                                >
                                  <img src={selectedMember.avatarUrl} alt={selectedMember.name} className="w-full h-full object-cover" />
                                </button>
                              </div>
                            ) : (
                              <div className="avatar-ring">
                                <div className={`w-24 h-24 lg:w-28 lg:h-28 rounded-full ${warmAvatarColor(selectedMember.avatarColor)} text-white font-bold text-3xl flex items-center justify-center uppercase`}>
                                  {selectedMember.name.charAt(0).toUpperCase()}
                                </div>
                              </div>
                            )}
                            {selectedMember.avatarUrl && isAdmin && (
                              <button
                                type="button"
                                onClick={() => canUseAI ? setRestyleMemberId(selectedMember.id) : setConsentOpen(true)}
                                className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-clay-500 hover:bg-clay-600 text-white flex items-center justify-center shadow-lift border-2 border-white transition-all hover:scale-105 active:scale-95 cursor-pointer"
                                title="Make a fun avatar"
                                aria-label="Make a fun avatar"
                              >
                                <Sparkles className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                          <div className="min-w-0">
                            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-ink-900 flex items-center gap-2.5 flex-wrap">
                              <span className="truncate">{memberName(selectedMember)}</span>
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

                        <div className="flex flex-wrap gap-1 bg-cream-200 p-1 rounded-2xl w-fit self-start md:self-auto select-none">
                          {TABS.filter(tab => (tab.id !== 'growth' || selectedMember.role === 'Child') && !(isBusinessSpace && HIDDEN_IN_BUSINESS.includes(tab.id))).map(tab => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setActiveTab(tab.id)}
                              className={`tab-pill px-3 ${activeTab === tab.id ? 'tab-pill-active' : ''}`}
                            >
                              <tab.icon className={`w-4 h-4 ${tab.id === 'favorites' ? 'fill-rosa-500 text-rosa-500' : ''}`} />
                              <span className="hidden sm:inline">{tab.label}</span>
                            </button>
                          ))}
                        </div>
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
                                  onViewDocument={setLightboxImage}
                                  canEdit={!demo && canWrite}
                                  showAstrology={!!settings.astrology}
                                  onShuffleAstrology={isAdmin ? () => (canUseAI ? shuffleAstrology(selectedMember.id) : setConsentOpen(true)) : undefined}
                                  astrologyBlurb={astroBlurb[selectedMember.id]}
                                />
                              )}
                              {activeTab === 'medical' && (
                                <MemberMedical member={selectedMember} onUpdate={handlePatchSelectedMember} />
                              )}
                              {activeTab === 'care' && (
                                <CareSchedule member={selectedMember} onUpdate={handlePatchSelectedMember} />
                              )}
                              {activeTab === 'ids' && (
                                <MemberIDs member={selectedMember} onUpdate={handlePatchSelectedMember} onAddDocument={handleAddDocument} country={settings.country || 'AT'} />
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
                              {activeTab === 'travel' && (
                                <MemberTravel member={selectedMember} onUpdate={handlePatchSelectedMember} />
                              )}
                              {activeTab === 'preferences' && (
                                <MemberPreferences member={selectedMember} onUpdate={handlePatchSelectedMember} />
                              )}
                              {activeTab === 'sayings' && (
                                <MemberSayings member={selectedMember} onUpdateMember={handleUpdateMember} canEdit={demo || canWrite} />
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
                                <SecureSecrets member={selectedMember} onUpdateMember={handleUpdateMember} />
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
                      <p className="text-[13px] text-ink-400 mt-1">Pick a family member from the list to see their things.</p>
                    </div>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer with honest sync status */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12 text-center pb-6">
        <div className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white rounded-full border border-cream-300/70 shadow-soft text-[12px] font-semibold text-ink-500">
          {demo ? (
            <>
              <span className="w-2 h-2 bg-honey-500 rounded-full"></span>
              <span>Demo preview — nothing is saved</span>
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
      </footer>

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

      <AddMemberModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={handleAddMember}
        isBusinessSpace={isBusinessSpace}
      />

      <EditMemberModal
        isOpen={isEditingProfile}
        member={selectedMember}
        onClose={() => setIsEditingProfile(false)}
        onSave={handleUpdateMember}
        isBusinessSpace={isBusinessSpace}
      />

      <HubSettingsModal
        isOpen={isSettingsOpen}
        settings={settings}
        isBusinessSpace={isBusinessSpace}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveSettings}
      />

      <ImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />

      {/* Floating AI assistant — only when AI is enabled (opt-in, off by default) */}
      {canUseAI && (
        <AssistantBubble
          members={members}
          onApplyEdits={handleApplyAiEdits}
          onAddMemberDoc={handleAddDocument}
          demo={demo}
          isBusinessSpace={isBusinessSpace}
          onOpenFunAvatar={isAdmin && selectedMember ? () => setRestyleMemberId(selectedMember.id) : undefined}
        />
      )}

      <AiConsentModal
        open={consentOpen}
        onEnable={async () => { await setAiConsent(true); setConsentOpen(false); }}
        onClose={() => setConsentOpen(false)}
        onOpenPrivacy={() => setLegalTab('privacy')}
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
        <EmergencyCard members={members} events={events} onClose={() => setShowEmergency(false)} />
      )}
      {showBabysitter && (
        <BabysitterMode members={members} events={events} onClose={() => setShowBabysitter(false)} />
      )}
      {showTravelPack && (
        <TravelPack members={members} events={events} onClose={() => setShowTravelPack(false)} />
      )}
      {showFamilyStats && (
        <FamilyStats members={members} events={events} onClose={() => setShowFamilyStats(false)} />
      )}
      {showFamilyQuiz && (
        <FamilyQuiz members={members} events={events} onClose={() => setShowFamilyQuiz(false)} />
      )}
      {showHealthTimeline && (
        <HealthTimeline members={members} events={events} onClose={() => setShowHealthTimeline(false)} />
      )}
    </div>
  );
}

function DemoUnavailable({ label }: { label: string }) {
  return (
    <div className="card text-center py-20 px-6">
      <h3 className="font-display text-xl font-semibold text-ink-900 mb-2">{label} isn&apos;t part of the demo</h3>
      <p className="text-[13px] text-ink-500">Sign in with Google to use it with your own family.</p>
    </div>
  );
}
